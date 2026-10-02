import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { staticAssets } from '../../packages/config/src/settings.ts'

/**
 * 构建产物边界守卫。
 *
 * 体积预算与代码分割守卫已随「局域网优先」移除（见
 * docs/adr/0049-lan-first-drop-size-and-coverage-gates.md）；保留两条与体积无关、
 * 一改就会静默失效的边界：
 * 1. 洪泛填充 Worker 由 Vite 打成独立 bundle：它的 import 图一旦引入 @draw-guess/shared barrel /
 *    config / strings / zod，整份协议 Schema 会被复制进 Worker chunk（曾因此多出 21.4 KiB gzip）；
 * 2. 静态资源缓存响应头：哈希产物长缓存、入口与 SPA 回退不缓存，时长唯一来源 staticAssets。
 */
describe('构建产物边界（静态守卫）', () => {
  const root = process.cwd()
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

  it('独立 Worker bundle 不引入 shared barrel、配置、文案或 zod（避免重复 Zod 图）', () => {
    // 只看真正的 import 说明符（注释中提及包名不算依赖）；轻量常量只允许 constants 子路径。
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

  it('服务端按哈希产物长缓存、入口与 SPA 回退不缓存，时长取自配置', () => {
    const source = read('apps/server/src/app.ts')
    expect(source).toContain('staticAssets.immutableMaxAgeSeconds')
    expect(source).toContain('immutable')
    expect(source).toContain("'no-cache'")
    expect(staticAssets.immutableMaxAgeSeconds).toBe(31_536_000)
  })
})
