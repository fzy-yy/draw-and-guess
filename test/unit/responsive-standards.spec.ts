import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { responsive } from '../../packages/config/src/settings.ts'

/**
 * 响应式与触控验收标准的一致性守卫。
 *
 * 该标准同时落在三处（config 阈值 / style 实现 / AGENTS 文档），
 * 任何一处漂移都会让人工验收与自动化验收结论不一致，因此用单测把三者钉在一起。
 * 对应章节：AGENTS.md「响应式与触控验收标准」。
 */
describe('响应式与触控验收标准（config ↔ style ↔ AGENTS）', () => {
  const root = process.cwd()
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
  const tokens = read('apps/client/src/style/tokens.css')
  const base = read('apps/client/src/style/base.css')
  const components = read('apps/client/src/style/components.css')
  const utilities = read('apps/client/src/style/utilities.css')
  const agents = read('AGENTS.md')

  it('三个基准视口固定为桌面 / 平板横屏 / 手机横屏', () => {
    expect(responsive.baselines.map((item) => [item.width, item.height])).toEqual([
      [1280, 720],
      [1024, 768],
      [844, 390],
    ])
  })

  it('触控命中区与可读字号阈值符合验收标准', () => {
    expect(responsive.minTouchTargetPx).toBe(44)
    expect(responsive.minBodyFontPx).toBe(12)
    expect(responsive.minSecondaryFontPx).toBeGreaterThanOrEqual(10)
    expect(responsive.minMicroFontPx).toBeGreaterThanOrEqual(9)
    // 密集控件（色板/表情/表格复选框）间距不足以容纳 44px，降级为「视觉 ≥ 20px 且命中区不重叠」
    expect(responsive.minDenseTargetPx).toBeGreaterThanOrEqual(20)
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

  it('触控命中区实现使用配置的 44px 阈值', () => {
    expect(components).toContain('.touch-target')
    expect(components).toContain(`max(100%, ${responsive.minTouchTargetPx}px)`)
    // 紧凑布局下控件自身达到 44px（2.75rem = 44px @ 16px 根字号）
    expect(utilities).toContain(`min-height: ${responsive.minTouchTargetPx / 16}rem`)
  })

  it('紧凑布局断点与共享类齐备，且断点取自配置阈值', () => {
    expect(utilities).toContain(`@container (max-height: ${responsive.compactStageHeightPx}px)`)
    for (const className of [
      '.compact-hide',
      '.compact-tight',
      '.compact-scroll',
      '.compact-control',
      '.compact-control-square',
      '.compact-rows-2',
      '.compact-rows-3',
      '.compact-wrap',
      '.compact-stack',
    ])
      expect(utilities, `缺少紧凑布局共享类：${className}`).toContain(className)
  })

  it('AGENTS.md 登记了三个基准视口与触控/可读阈值', () => {
    for (const text of ['1280×720', '1024×768', '844×390', '44×44', '响应式与触控验收标准'])
      expect(agents, `AGENTS.md 缺少验收标准描述：${text}`).toContain(text)
  })
})
