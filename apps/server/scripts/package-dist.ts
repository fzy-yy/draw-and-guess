/**
 * 构建 Windows 分发产物（slim / full 两包）。
 *
 * 产出：
 *   release/slim/draw-and-guess/   → release/draw-and-guess-<version>-win-x64-slim.zip
 *   release/full/draw-and-guess/   → release/draw-and-guess-<version>-win-x64-full.zip
 *
 * 两包共有：server.mjs（依赖内联，better-sqlite3 外置）、client/ 前端、vocabulary/ 内置词库、
 * node_modules/better-sqlite3/（Node-API 预编译）、start.cmd、使用说明.txt。
 * full 额外携带 runtime/node.exe（+ Node LICENSE），让未安装 Node 的用户开箱即用。
 *
 * 内置 Node 的下载带同源 SHASUMS256 校验（写缓存与命中时都比对，损坏自动重下一次；
 * 校验文件缺失/无条目按 fail-fast 中止），信任边界与取舍见 docs/adr/0034。
 * 文本模板（start.cmd / 使用说明）与 Node 版本解析都是 src/build/ 下的纯函数，可单测。
 *
 * 数据目录（game.db / logs / vocabulary/custom / .env）由 server.mjs 首次启动时在其旁创建。
 */
import { build } from 'esbuild'
import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { APP_CONFIG } from '@draw-guess/config'
import { buildStartScript, buildUsageNotes, type DistVariant } from '../src/build/dist-templates.ts'
import {
  buildNodeDistUrl,
  buildNodeIndexUrl,
  buildNodeShasumsUrl,
  buildNodeZipName,
  MIN_NODE_MAJOR,
  parseNodeShasumsEntry,
  pickLatestBundledNode,
} from '../src/build/node-dist.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(scriptDir, '..')
const repoRoot = resolve(serverRoot, '..', '..')
const releaseRoot = join(repoRoot, 'release')
const cacheDir = join(releaseRoot, '.cache')

/** 默认使用国内镜像；海外（含 CI）或自建镜像可通过 NODE_DIST_MIRROR 覆盖。 */
const DEFAULT_NODE_MIRROR = 'https://npmmirror.com/mirrors/node/'

/** 构建前端产物；经 shell 执行（Windows 下 pnpm 实为 pnpm.cmd）。 */
function buildClient(): void {
  execSync('pnpm --filter @draw-guess/client build', { stdio: 'inherit', cwd: repoRoot })
}

/**
 * 把服务端打成 ESM 单文件；better-sqlite3 外置并由随包目录提供。
 * bufferutil / utf-8-validate 是 socket.io 的可选原生加速模块，随包未提供——保持外置
 * 让 Node 在模块缺失时自动降级到纯 JS 实现（见 docs/adr/0034）。
 */
async function bundleServer(appDir: string): Promise<void> {
  await build({
    entryPoints: [join(serverRoot, 'src/index.ts')],
    outfile: join(appDir, 'server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    // 最低系统 Node 主版本单一来源（node-dist 常量），start.cmd 检测与之联动。
    target: `node${MIN_NODE_MAJOR}`,
    sourcemap: false,
    external: ['better-sqlite3', 'bufferutil', 'utf-8-validate'],
    // ESM 产物内联的 CJS 依赖（如 safe-buffer）会做动态 require('buffer')，需要提供真实 require。
    banner: {
      js: "import { createRequire as __drawGuessCreateRequire } from 'node:module'; const require = __drawGuessCreateRequire(import.meta.url);",
    },
    define: { 'process.env.DRAW_GUESS_RUNTIME_MODE': '"dist"' },
    logLevel: 'info',
  })
}

/** 复制前端产物、内置词库与 better-sqlite3 预编译模块（只取 Windows x64 平台包，压缩体积）。 */
function copyAssets(appDir: string): void {
  cpSync(join(repoRoot, 'apps/client/dist'), join(appDir, 'client'), { recursive: true })

  const vocabularyTarget = join(appDir, 'vocabulary')
  mkdirSync(vocabularyTarget, { recursive: true })
  for (const file of readdirSync(join(repoRoot, 'vocabulary'))) {
    if (file.endsWith('.db'))
      copyFileSync(join(repoRoot, 'vocabulary', file), join(vocabularyTarget, file))
  }

  const require = createRequire(import.meta.url)
  const betterSqliteDir = dirname(require.resolve('better-sqlite3/package.json'))
  const betterSqliteTarget = join(appDir, 'node_modules/better-sqlite3')
  cpSync(join(betterSqliteDir, 'lib'), join(betterSqliteTarget, 'lib'), { recursive: true })
  copyFileSync(join(betterSqliteDir, 'package.json'), join(betterSqliteTarget, 'package.json'))
  mkdirSync(join(betterSqliteTarget, 'prebuilds'), { recursive: true })
  copyFileSync(
    join(betterSqliteDir, 'prebuilds/win32-x64.node'),
    join(betterSqliteTarget, 'prebuilds/win32-x64.node'),
  )
}

/** 解析要内置的 Node 版本：NODE_VERSION 可钉死，否则取镜像索引里最新的稳定 v24.x。 */
async function resolveNodeVersion(mirror: string): Promise<string> {
  const pinned = process.env.NODE_VERSION?.trim()
  if (pinned) return pinned.replace(/^v/u, '')
  const indexUrl = buildNodeIndexUrl(mirror)
  const response = await fetch(indexUrl)
  if (!response.ok)
    throw new Error(`获取 Node 分发索引失败：HTTP ${response.status}（${indexUrl}）`)
  return pickLatestBundledNode(await response.json())
}

/** 流式计算文件 sha256（hex 小写），避免把约 36MB 的 zip 整个读进内存。 */
function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    hash.on('error', rejectHash)
    hash.on('finish', () => resolveHash(hash.digest('hex')))
    createReadStream(path).on('error', rejectHash).pipe(hash)
  })
}

/** 下载文本资源；非 2xx 视为环境异常，直接抛错（fail-fast）。 */
async function fetchRequiredText(url: string, label: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`获取${label}失败：HTTP ${response.status}（${url}）`)
  return response.text()
}

async function downloadNodeZip(url: string, target: string): Promise<void> {
  mkdirSync(dirname(target), { recursive: true })
  process.stdout.write(`下载 Node 运行时：${url}\n`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`下载 Node 运行时失败：HTTP ${response.status}（${url}）`)
  writeFileSync(target, Buffer.from(await response.arrayBuffer()))
}

/**
 * 取得（必要时下载）与同源 SHASUMS256.txt 比对通过的 Node zip 缓存路径。
 * 校验链：缓存命中先验 → 不符删除重下一次 → 新下载再验 → 仍不符报错。
 * 只自愈一次是有意为之：镜像上 zip 与校验文件本身互相矛盾时，无限重下载只会掩盖问题。
 * SHASUMS 缺失 / 无目标条目按 fail-fast 中止，不允许未校验的下载进入产物。
 */
async function ensureVerifiedNodeZip(mirror: string, version: string): Promise<string> {
  const zipName = buildNodeZipName(version)
  const zipPath = join(cacheDir, zipName)
  const shasumsText = await fetchRequiredText(
    buildNodeShasumsUrl(mirror, version),
    'Node 校验文件 SHASUMS256.txt',
  )
  const expectedHash = parseNodeShasumsEntry(shasumsText, zipName)
  if (existsSync(zipPath)) {
    if ((await sha256File(zipPath)) === expectedHash) return zipPath
    process.stdout.write(`Node 缓存校验不符（疑似截断/损坏），重新下载一次：${zipName}\n`)
    rmSync(zipPath, { force: true })
  }
  await downloadNodeZip(buildNodeDistUrl(mirror, version), zipPath)
  if ((await sha256File(zipPath)) !== expectedHash) {
    rmSync(zipPath, { force: true })
    throw new Error(
      `Node 运行时下载未通过 sha256 校验（镜像可能同步不完整）：${zipName}，可用 NODE_DIST_MIRROR 换源重试`,
    )
  }
  return zipPath
}

/**
 * 从缓存 zip 解压并只取 node.exe 与 LICENSE 放入 runtime/（不含 npm/npx/corepack）；
 * 用毕立即删除解压临时目录，避免约 90MB 的残留在 release/.cache/ 里逐次累积。
 */
function installNodeRuntime(appDir: string, version: string, zipPath: string): void {
  const extractDir = join(cacheDir, `extract-node-v${version}`)
  rmSync(extractDir, { recursive: true, force: true })
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`,
      ],
      { stdio: 'inherit' },
    )
    const root = join(extractDir, `node-v${version}-win-x64`)
    const runtimeDir = join(appDir, 'runtime')
    mkdirSync(runtimeDir, { recursive: true })
    copyFileSync(join(root, 'node.exe'), join(runtimeDir, 'node.exe'))
    copyFileSync(join(root, 'LICENSE'), join(runtimeDir, 'LICENSE'))
  } finally {
    rmSync(extractDir, { recursive: true, force: true })
  }
}

/** 用 PowerShell 打成 zip（归档内含 draw-and-guess/ 顶层目录）。 */
function zipApp(appDir: string, zipPath: string): void {
  rmSync(zipPath, { force: true })
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -LiteralPath '${appDir}' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: 'inherit' },
  )
}

/** 落盘一个变体的两份文本产物；内容生成在 dist-templates 纯函数里（有单测锁定）。 */
function writeVariantTexts(appDir: string, version: string, variant: DistVariant): void {
  writeFileSync(join(appDir, 'start.cmd'), buildStartScript(variant), 'utf8')
  writeFileSync(join(appDir, '使用说明.txt'), buildUsageNotes(version, variant), 'utf8')
}

/** 两个分发变体的固定构建顺序（先 slim 后 full）。 */
const VARIANTS: readonly DistVariant[] = ['slim', 'full']

async function main(): Promise<void> {
  // 版本唯一权威源在 @draw-guess/config（直接 import：格式变动时编译即失败，绝不静默错读）。
  const version = APP_CONFIG.app.version
  const mirror = process.env.NODE_DIST_MIRROR?.trim() || DEFAULT_NODE_MIRROR
  if (!existsSync(join(repoRoot, 'vocabulary'))) throw new Error('缺少 vocabulary/ 词库目录')

  buildClient()
  // 预先解析、下载并校验内置 Node（full 包用），失败即整体失败，避免产出不完整的 full 包。
  const nodeVersion = await resolveNodeVersion(mirror)
  const nodeZipPath = await ensureVerifiedNodeZip(mirror, nodeVersion)

  for (const variant of VARIANTS) {
    const withNode = variant === 'full'
    const outDir = join(releaseRoot, variant)
    const appDir = join(outDir, 'draw-and-guess')
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(appDir, { recursive: true })

    await bundleServer(appDir)
    copyAssets(appDir)
    if (withNode) installNodeRuntime(appDir, nodeVersion, nodeZipPath)
    writeVariantTexts(appDir, version, variant)
    const zipPath = join(releaseRoot, `draw-and-guess-${version}-win-x64-${variant}.zip`)
    zipApp(appDir, zipPath)
    process.stdout.write(`已生成 ${variant} 包：${zipPath}\n`)
  }

  process.stdout.write(
    `分发产物构建完成（版本 ${version}，内置 Node v${nodeVersion}，已通过 sha256 校验）。\n`,
  )
}

await main()
