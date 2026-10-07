import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { app } from '../../packages/config/src/app.ts'

/**
 * 文档与工程一致性守卫。
 *
 * 守护四类容易「悄悄漂移」的约定：
 * 1. **路径与大小写**：AGENTS.md / README.md 里写的仓库路径必须存在于 git 索引，且逐字符大小写一致
 *    （Windows 大小写不敏感，本地看不出的错误会在 Linux CI 上炸掉——历史上 AGENTS.md 就这么错过一次）；
 * 2. **版本单一权威源**：产品版本只允许定义在 `packages/config/src/app.ts`，文档里的版本号必须与它一致；
 * 3. **TS 文件命名**：统一 kebab-case，例外仅 `useXxx.ts` 组合式函数与 `*.config/*.spec/*.page`；
 * 4. **README 登记结构**：README 声明的组件目录与样式分层必须真实存在。
 */
const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

/**
 * 仓库中的全部文件路径（唯一可信的「仓库里到底有什么、大小写是什么」来源）：
 * 已跟踪 + 未跟踪但未被忽略。git 报告的是**磁盘上的真实大小写**，
 * 因此在 Windows 上也能发现「大小写写错」的引用（这类错误只在 Linux CI 才会暴露）。
 */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 运行时生成、不入库的路径：文档可以提及，但不要求出现在索引里。 */
const RUNTIME_ONLY_PATHS = new Set(['apps/server/data/game.db'])

describe('文档与工程一致性', () => {
  const tracked = new Set(trackedFiles())
  const agents = read('AGENTS.md')
  const readme = read('README.md')
  const docs: Array<[string, string]> = [
    ['AGENTS.md', agents],
    ['README.md', readme],
  ]

  it('关键路径存在且大小写与 git 索引一致', () => {
    for (const path of [
      'packages/config/src/index.ts',
      'packages/strings/src/index.ts',
      'packages/shared/src/protocol/constants.ts',
      'apps/server/src/config/index.ts',
      'docs/adr/README.md',
      'apps/server/src/runtime.ts',
      'apps/client/src/stores/push-protocol.ts',
      'apps/client/src/components/game/GameCanvas.vue',
      'test/e2e/specs/07-responsive-touch.spec.ts',
      'test/e2e/specs/08-static-asset-cache.spec.ts',
      'test/unit/bundle-boundary.spec.ts',
      'docs/adr/0049-lan-first-drop-size-and-coverage-gates.md',
      'test/unit',
      'test/e2e',
      '.github/workflows/quality.yml',
    ]) {
      const absolute = resolve(root, path)
      expect(existsSync(absolute), `缺少登记路径：${path}`).toBe(true)
      // 目录由 git 以文件条目形式记录，只有文件才能用「逐字符大小写」比对
      if (statSync(absolute).isFile())
        expect(tracked.has(path), `${path} 不在仓库文件列表中（路径或大小写不一致？）`).toBe(true)
    }
  })

  it('文档引用的仓库路径都真实存在且大小写正确', () => {
    // 只校验「以顶层目录开头」的完整仓库路径；相对片段（如 composables/useToasts.ts）由上下文决定，跳过。
    const topLevelPrefixes = ['apps/', 'packages/', 'test/', 'docs/', 'vocabulary/']
    const tokenPattern = /`([A-Za-z0-9_@./-]+\.(?:ts|mts|vue|css|json|md|yml|yaml|db|html))`/gu
    const offenders: string[] = []
    for (const [docName, text] of docs) {
      for (const match of text.matchAll(tokenPattern)) {
        const token = match[1]!
        if (!topLevelPrefixes.some((prefix) => token.startsWith(prefix))) continue
        if (RUNTIME_ONLY_PATHS.has(token)) continue
        if (!tracked.has(token)) offenders.push(`${docName}: ${token}`)
      }
    }
    expect(offenders, `文档引用了不存在或大小写不符的路径：\n${offenders.join('\n')}`).toEqual([])
  })

  it('应用版本只有一个权威源：packages/config/src/app.ts，且文档与之一致', () => {
    expect(agents, 'AGENTS.md 应登记应用版本').toContain(`版本 \`${app.version}\``)
    expect(readme, 'README 应说明版本权威源').toContain('packages/config/src/app.ts')
    // 版本号不得在其它源码里重复硬编码（测试与文档不受此限）
    const offenders = trackedFiles()
      .filter(
        (path) =>
          /\.(ts|vue)$/u.test(path) &&
          path !== 'packages/config/src/app.ts' &&
          !path.startsWith('test/') &&
          !path.endsWith('test-fixture.ts'),
      )
      .filter((path) => read(path).includes(`'${app.version}'`))
    expect(
      offenders,
      `版本号应只在 packages/config/src/app.ts 定义：${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('TS 文件命名统一 kebab-case（组合式函数与工具链配置除外）', () => {
    const kebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\.m?ts$/u
    const isAllowed = (fileName: string) =>
      /^use[A-Z][A-Za-z0-9]*\.ts$/u.test(fileName) || /\.(config|spec|page)\.ts$/u.test(fileName)
    const offenders = trackedFiles()
      .filter((path) => /\.m?ts$/u.test(path))
      .filter((path) => {
        const fileName = path.split('/').pop()!
        return !isAllowed(fileName) && !kebabCase.test(fileName)
      })
    expect(offenders, `以下 TS 文件不符合 kebab-case 命名：\n${offenders.join('\n')}`).toEqual([])
  })

  it('README 登记的工程结构、组件目录与样式分层真实存在', () => {
    const structure = readme.match(/## 工程结构\s*```text\n([\s\S]*?)```/u)?.[1]
    expect(structure, 'README 应有「工程结构」代码块').toBeTruthy()
    for (const path of [
      'apps/client/',
      'apps/server/',
      'packages/shared/',
      'packages/config/',
      'packages/strings/',
      'vocabulary/',
      'docs/adr/',
    ])
      expect(structure, `README 工程结构缺少：${path}`).toContain(path)

    // README 声明的组件子目录（barrel 分层）必须都存在
    for (const dir of ['common', 'game', 'lobby', 'room', 'settings']) {
      expect(
        existsSync(resolve(root, 'apps/client/src/components', dir)),
        `缺少组件目录：${dir}`,
      ).toBe(true)
      expect(structure, `README 工程结构未登记组件目录：${dir}/`).toContain(`${dir}/`)
    }

    // README 声明的样式分层模块必须都存在
    for (const file of [
      'index.css',
      'tokens.css',
      'base.css',
      'components.css',
      'utilities.css',
      'animations.css',
      'other.css',
    ]) {
      expect(
        existsSync(resolve(root, 'apps/client/src/style', file)),
        `缺少样式模块：${file}`,
      ).toBe(true)
      expect(readme, `README 样式分层未登记：${file}`).toContain(file)
    }
  })

  it('AGENTS 登记的质量命令在根 package.json 中存在', () => {
    const rootPackage = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    for (const command of [
      'format',
      'format:check',
      'lint',
      'typecheck',
      'build',
      'test:unit',
      'test:e2e',
    ])
      expect(rootPackage.scripts?.[command], `缺少根命令：${command}`).toBeTruthy()
  })

  it('暂存 Git tree 只跟踪大写 AGENTS.md', () => {
    const cwd = process.cwd()
    const stagedTree = execFileSync('git', ['write-tree'], {
      cwd,
      encoding: 'utf8',
    }).trim()
    const trackedPaths = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', stagedTree], {
      cwd,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean)
    const agentsPaths = trackedPaths.filter((path) => path.toLowerCase() === 'agents.md')

    expect(agentsPaths).toEqual(['AGENTS.md'])
  })

  it('不再引用已删除的旧配置路径', () => {
    expect(agents).not.toContain('`config.ts`')
    expect(agents).not.toContain('`config/strings.ts`')
  })
})
