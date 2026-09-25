import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from '../../packages/config/src/settings.ts'

/**
 * 首屏体积切分与静态资源缓存的静态守卫。
 *
 * 运行时效果由 `test/e2e/specs/08-performance-budget.spec.ts` 断言（真实构建产物 + 真实响应头）；
 * 这里只挡「写法一改就悄悄失效、但功能测试照样通过」的回归：
 * barrel 静态 re-export 会让懒加载模块重新回到主 chunk，代码分割随之失效。
 */
describe('首屏体积切分与静态资源缓存（静态守卫）', () => {
  const root = process.cwd()
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
  /** 精确匹配 `export { ... as <Name> ... }`，避免把注释里提到的模块名误判为导出。 */
  const exportPattern = (name: string) => new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`)

  it('懒加载模块不得被组件 barrel 静态 re-export', () => {
    const barrels: Array<[string, string]> = [
      ['apps/client/src/components/room/index.ts', 'VocabularyDialog'],
    ]
    for (const [path, moduleName] of barrels) {
      expect(read(path), `${path} 不应静态导出懒加载模块 ${moduleName}`).not.toMatch(
        exportPattern(moduleName),
      )
    }
  })

  it('低频组件经 defineLazyComponent 懒加载', () => {
    const sites: Array<[string, string]> = [
      ['apps/client/src/views/RoomView.vue', 'VocabularyDialog.vue'],
    ]
    for (const [path, moduleName] of sites) {
      const source = read(path)
      expect(source, `${path} 应通过 defineLazyComponent 懒加载 ${moduleName}`).toContain(
        'defineLazyComponent',
      )
      expect(source, `${path} 应动态 import ${moduleName}`).toContain(moduleName)
    }
    // 礼花库只在对局内猜中时按需下载
    expect(read('apps/client/src/utils/confetti.ts')).toContain("await import('canvas-confetti')")
  })

  it('设置页与诊断页必须静态导入（懒加载首开白闪的回归守卫，见 ADR-0014）', () => {
    for (const path of ['apps/client/src/App.vue', 'apps/client/src/views/GameView.vue']) {
      const source = read(path)
      expect(source, `${path} 应静态导入 SettingsView`).toMatch(
        /import\s+SettingsView\s+from\s+['"]@\/views\/SettingsView\.vue['"]/u,
      )
      expect(source, `${path} 不应再动态 import SettingsView（会复现首开白闪）`).not.toContain(
        "import('@/views/SettingsView.vue')",
      )
    }
    const settingsSource = read('apps/client/src/views/SettingsView.vue')
    expect(settingsSource, 'SettingsView 应经 barrel 静态导入 DiagnosticsTab').toMatch(
      /import\s*\{[^}]*DiagnosticsTab[^}]*\}\s*from\s*['"]@\/components\/settings['"]/u,
    )
    expect(settingsSource).not.toContain("import('@/components/settings/DiagnosticsTab.vue')")
    // 入口视图文件不得残留 lazy 工厂引用（设置页场景）
    expect(read('apps/client/src/App.vue')).not.toContain('defineLazyComponent')
  })

  it('服务端按哈希产物长缓存、入口与 SPA 回退不缓存，时长取自配置', () => {
    const source = read('apps/server/src/app.ts')
    expect(source).toContain('performance.immutableAssetMaxAgeSeconds')
    expect(source).toContain('immutable')
    expect(source).toContain("'no-cache'")
    expect(performance.immutableAssetMaxAgeSeconds).toBe(31_536_000)
  })

  it('独立 Worker bundle 不引入 shared barrel、配置、文案或 zod（避免重复 Zod 图）', () => {
    // flood-fill.worker-entry.ts 由 Vite 打成独立 bundle：它的 import 图一旦引入
    // @draw-guess/shared barrel / config / strings / zod，整份协议 Schema 会被复制进 Worker chunk。
    // 这里只看真正的 import 说明符（注释中提及包名不算依赖）；轻量常量只允许 constants 子路径。
    for (const path of [
      'apps/client/src/canvas/flood-fill.worker-entry.ts',
      'apps/client/src/canvas/flood-fill.ts',
    ]) {
      const specifiers = [...read(path).matchAll(/from\s+['"]([^'"]+)['"]/gu)].map(
        (match) => match[1]!,
      )
      for (const specifier of specifiers) {
        expect(specifier, `${path} 不允许依赖 ${specifier}`).not.toBe('@draw-guess/shared')
        expect(specifier, `${path} 不允许依赖 ${specifier}`).not.toBe('zod')
        expect(specifier, `${path} 不允许依赖 ${specifier}`).not.toMatch(
          /^@draw-guess\/(config|strings)/u,
        )
        if (specifier.startsWith('@draw-guess/shared/')) {
          expect(specifier, `${path} 的协议依赖只允许轻量常量`).toBe(
            '@draw-guess/shared/protocol/constants',
          )
        }
      }
    }
  })

  it('体积预算为正，且首屏预算大于入口预算', () => {
    expect(performance.mainEntryGzipKib).toBeGreaterThan(0)
    expect(performance.firstScreenTransferKib).toBeGreaterThan(performance.mainEntryGzipKib)
  })
})
