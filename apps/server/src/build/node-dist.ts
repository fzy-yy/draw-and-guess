/**
 * 分发构建期工具：解析要内置的 Node 版本、拼接镜像下载地址、校验下载完整性。
 *
 * 纯函数（不触碰网络/文件系统），供 `scripts/package-dist.ts` 使用并单独单测。
 * 分发包始终内置 Node，让没有安装 Node 的用户也能直接运行。
 */

/** 内置 Node 的主版本线（Active LTS）；镜像索引解析、下载地址与 esbuild target 共用。 */
export const BUNDLED_NODE_MAJOR = 24

/** 内置 Node 主版本线的稳定版本号形如 `v24.1.2`（排除 `-rc`/`-nightly` 等预发布后缀）。 */
const BUNDLED_STABLE = new RegExp(`^v${BUNDLED_NODE_MAJOR}\\.\\d+\\.\\d+$`)

/** 把 `24.1.2` 形式解析为数字三元组，缺位补 0（避免 `noUncheckedIndexedAccess` 下的断言）。 */
function parseSemver(value: string): [number, number, number] {
  const [major = '0', minor = '0', patch = '0'] = value.split('.')
  return [Number(major), Number(minor), Number(patch)]
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left)
  const b = parseSemver(right)
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * 从 Node 官方分发索引（`index.json`）中解析最新的稳定 `v{BUNDLED_NODE_MAJOR}.x` 版本号
 * （去掉 `v` 前缀）。索引格式非法或没有该主版本线的稳定版时抛错，避免静默内置错误版本。
 */
export function pickLatestBundledNode(index: unknown): string {
  if (!Array.isArray(index)) throw new Error('Node 分发索引格式不正确（应为数组）')
  const versions: string[] = []
  for (const entry of index as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const version = (entry as { version?: unknown }).version
    if (typeof version === 'string' && BUNDLED_STABLE.test(version)) versions.push(version.slice(1))
  }
  if (versions.length === 0) {
    throw new Error(`Node 分发索引中未找到 v${BUNDLED_NODE_MAJOR}.x 稳定版本`)
  }
  return versions.reduce((latest, current) =>
    compareSemver(current, latest) > 0 ? current : latest,
  )
}

/** 规范化镜像根地址为「末尾恰有一个斜杠」——本模块内所有 URL 拼接的唯一口径。 */
export function normalizeNodeMirror(mirror: string): string {
  return mirror.endsWith('/') ? mirror : `${mirror}/`
}

/** 镜像的发布索引地址（解析内置 Node 版本用）。 */
export function buildNodeIndexUrl(mirror: string): string {
  return `${normalizeNodeMirror(mirror)}index.json`
}

/** 某个版本的 win-x64 发行 zip 文件名（缓存路径与校验条目名共用）。 */
export function buildNodeZipName(version: string): string {
  return `node-v${version}-win-x64.zip`
}

/** 拼接官方分发镜像下的 win-x64 zip 下载地址。 */
export function buildNodeDistUrl(mirror: string, version: string): string {
  return `${normalizeNodeMirror(mirror)}v${version}/${buildNodeZipName(version)}`
}

/** 拼接同一版本目录下的 SHASUMS256.txt 地址（与 zip 同源，防截断/缓存损坏，见 ADR-0034）。 */
export function buildNodeShasumsUrl(mirror: string, version: string): string {
  return `${normalizeNodeMirror(mirror)}v${version}/SHASUMS256.txt`
}

/**
 * 从 SHASUMS256.txt 正文中取出目标文件的 sha256（十六进制小写）。
 * 行格式为 `<hash>  <文件名>`，二进制标记 `*` 前缀可选；找不到目标条目或哈希字段非法时抛错，
 * 由构建脚本按 fail-fast 处理——校验文件异常时绝不允许静默放行未校验的下载。
 */
export function parseNodeShasumsEntry(shasumsText: string, fileName: string): string {
  for (const line of shasumsText.split(/\r?\n/u)) {
    const matched = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/u)
    if (!matched) continue
    const [, hash, entry] = matched
    if (entry?.trim() === fileName && hash) return hash.toLowerCase()
  }
  throw new Error(`SHASUMS256.txt 中未找到「${fileName}」的有效校验条目`)
}
