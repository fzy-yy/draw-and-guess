import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { responsive } from '../../packages/config/src/settings.ts'

/**
 * 响应式缩放与可读验收标准的一致性守卫。
 *
 * 该标准同时落在三处（config 阈值 / style 实现 / AGENTS 文档），
 * 任何一处漂移都会让人工验收与自动化验收结论不一致，因此用单测把三者钉在一起。
 * 对应章节：AGENTS.md「响应式与触控验收标准」。
 *
 * 现行口径：主要适配电脑网页端；控件随舞台等比缩放、不设像素下限
 * （44px 触控契约与紧凑布局均已废除）；仅密集控件保留 minDenseTargetPx
 * 视觉下限，字号保留可读下限；竖屏拦截保留。
 */
describe('响应式缩放与可读验收标准（config ↔ style ↔ AGENTS）', () => {
  const root = process.cwd()
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
  const tokens = read('apps/client/src/style/tokens.css')
  const base = read('apps/client/src/style/base.css')
  const components = read('apps/client/src/style/components.css')
  const utilities = read('apps/client/src/style/utilities.css')
  const agents = read('AGENTS.md')

  it('验收基准视口只保留桌面网页端', () => {
    expect(responsive.baselines.map((item) => [item.width, item.height])).toEqual([[1280, 720]])
  })

  it('密集控件视觉下限与可读字号阈值符合验收标准', () => {
    expect(responsive.minBodyFontPx).toBe(12)
    expect(responsive.minSecondaryFontPx).toBeGreaterThanOrEqual(10)
    expect(responsive.minMicroFontPx).toBeGreaterThanOrEqual(9)
    // 密集控件（色板/表情/表格与筛选复选框）保留 16px 视觉下限，防止小窗下缩到看不见
    expect(responsive.minDenseTargetPx).toBe(16)
  })

  it('44px 触控契约与紧凑布局均已废除：样式层不再存在相关定义', () => {
    // 触控阈值与紧凑断点配置整体移除（命中区即视觉尺寸；不再按舞台高度切换布局）
    expect(responsive).not.toHaveProperty('minTouchTargetPx')
    expect(responsive).not.toHaveProperty('compactStageHeightPx')
    // .touch-target 外扩类、.compact-control 保底类与 @container 紧凑块不再「定义」
    // （只匹配行首的类规则声明；注释里以「*」开头提及历史不算）
    expect(components).not.toMatch(/^[ \t]*\.touch-target\s*[:{]/m)
    expect(utilities).not.toMatch(/^[ \t]*\.compact-control(-square)?\s*[:{]/m)
    expect(utilities).not.toMatch(
      /^[ \t]*\.compact-(tight|hide|scroll|rows-2|rows-3|wrap|stack)\s*\{/m,
    )
    expect(utilities).not.toContain('@container')
    // 组件模板的 class 绑定中不允许再出现契约/紧凑类（注释里提及历史不在此列）
    const violations: string[] = []
    const classPattern =
      /class="[^"]*\b(?:touch-target|compact-control(?:-square)?|compact-(?:tight|hide|scroll|rows-2|rows-3|wrap|stack))\b/
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.name.endsWith('.vue') && classPattern.test(read(path))) violations.push(path)
      }
    }
    walk(resolve(root, 'apps/client/src'))
    expect(violations, `组件仍在使用已废除的契约/紧凑类：${violations.join(', ')}`).toEqual([])
  })

  it('偶数字号标尺为每一档声明了不低于阈值的像素下限', () => {
    expect(tokens).toContain(`--text-fs-16: max(1em, ${responsive.minBodyFontPx}px)`)
    expect(tokens).toContain(`--text-fs-14: max(0.875em, ${responsive.minSecondaryFontPx + 1}px)`)
    expect(tokens).toContain(`--text-fs-12: max(0.75em, ${responsive.minSecondaryFontPx}px)`)
    expect(tokens).toContain(`--text-fs-10: max(0.625em, ${responsive.minMicroFontPx}px)`)
    // 大字号同样有下限，避免低高度舞台下标题退化为小字
    expect(tokens).toContain('--text-fs-48: max(3em,')
    expect(tokens).toContain('--text-fs-96: max(6em,')
  })

  it('舞台基准字号设有可读下限（不再无限等比缩小）', () => {
    expect(base).toMatch(/\.game-stage\s*\{[^}]*font-size:\s*clamp\(12px/)
  })

  it('AGENTS.md 登记了桌面基准、等比缩放口径与可读/密集阈值', () => {
    for (const text of [
      '1280×720',
      '响应式与触控验收标准',
      '等比缩放',
      '16px',
      '电脑网页端',
      '竖屏',
    ])
      expect(agents, `AGENTS.md 缺少验收标准描述：${text}`).toContain(text)
  })
})
