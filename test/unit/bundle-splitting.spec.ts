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
      ['apps/client/src/components/settings/index.ts', 'DiagnosticsTab'],
    ]
    for (const [path, moduleName] of barrels) {
      expect(read(path), `${path} 不应静态导出懒加载模块 ${moduleName}`).not.toMatch(
        exportPattern(moduleName),
      )
    }
  })

  it('低频模块经 defineLazyComponent 懒加载', () => {
    const sites: Array<[string, string]> = [
      ['apps/client/src/App.vue', 'SettingsView.vue'],
      ['apps/client/src/views/GameView.vue', 'SettingsView.vue'],
      ['apps/client/src/views/SettingsView.vue', 'DiagnosticsTab.vue'],
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

  it('服务端按哈希产物长缓存、入口与 SPA 回退不缓存，时长取自配置', () => {
    const source = read('apps/server/src/app.ts')
    expect(source).toContain('performance.immutableAssetMaxAgeSeconds')
    expect(source).toContain('immutable')
    expect(source).toContain("'no-cache'")
    expect(performance.immutableAssetMaxAgeSeconds).toBe(31_536_000)
  })

  it('体积预算为正，且首屏预算大于入口预算', () => {
    expect(performance.mainEntryGzipKib).toBeGreaterThan(0)
    expect(performance.firstScreenTransferKib).toBeGreaterThan(performance.mainEntryGzipKib)
  })
})
