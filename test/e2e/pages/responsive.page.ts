import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { responsive } from '../../../packages/config/src/settings.ts'

/**
 * 响应式与触控验收断言辅助（供 specs/07-responsive-touch.spec.ts 使用）。
 *
 * 验收标准见 AGENTS.md「响应式与触控验收标准」章节，阈值唯一来源是 packages/config/src/settings.ts 的 responsive。
 * 这里只做「测量 + 断言」，不引入任何业务规则。
 */

/** 三个验收基准视口（桌面 / 平板横屏 / 手机横屏）。 */
export const BASELINES = responsive.baselines

export type Baseline = (typeof BASELINES)[number]

/** 把视口切到某个基准。 */
export async function applyBaseline(page: Page, baseline: Baseline): Promise<void> {
  await page.setViewportSize({ width: baseline.width, height: baseline.height })
}

/**
 * 当前是否处于紧凑布局（与 style/utilities.css 的 `@container (max-height: …)` 一致）。
 * 容器查询按容器的**内容盒**求值，因此这里用 clientHeight（内容盒高度）而非
 * getBoundingClientRect().height（含舞台边框，会多算约 2×0.28cqh）。
 */
export async function isCompact(page: Page): Promise<boolean> {
  const height = await page.locator('.game-stage').evaluate((element) => element.clientHeight)
  return height <= responsive.compactStageHeightPx
}

/** 舞台（.game-stage）的位置与尺寸。 */
export async function stageRect(page: Page) {
  return page.locator('.game-stage').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    }
  })
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/**
 * 生效命中区：元素自身盒 + `.touch-target::after` 扩展盒的并集。
 *
 * 触控契约允许「视觉尺寸 < 44px、命中区 ≥ 44px」，因此不能只看 boundingBox；
 * 这里读取伪元素的计算宽高（共享类固定为「以元素中心对齐」）还原命中区。
 */
export async function effectiveHitBox(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    let width = rect.width
    let height = rect.height
    if (element.classList.contains('touch-target')) {
      const pseudo = getComputedStyle(element, '::after')
      width = Math.max(width, Number.parseFloat(pseudo.width) || 0)
      height = Math.max(height, Number.parseFloat(pseudo.height) || 0)
    }
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    return {
      left: centerX - width / 2,
      top: centerY - height / 2,
      right: centerX + width / 2,
      bottom: centerY + height / 2,
      width,
      height,
    }
  })
}

/** 关键交互控件的命中区必须 ≥ minPx（默认取配置里的 44px）。 */
export async function assertTouchTarget(
  locator: Locator,
  label: string,
  minPx: number = responsive.minTouchTargetPx,
): Promise<void> {
  await expect(locator, `${label} 应可见`).toBeVisible()
  const box = await effectiveHitBox(locator)
  expect(
    box.width,
    `${label} 命中区宽度应 ≥ ${minPx}px（实际 ${box.width.toFixed(1)}px）`,
  ).toBeGreaterThanOrEqual(minPx - 0.5)
  expect(
    box.height,
    `${label} 命中区高度应 ≥ ${minPx}px（实际 ${box.height.toFixed(1)}px）`,
  ).toBeGreaterThanOrEqual(minPx - 0.5)
}

/**
 * 控件自身（不含 .touch-target 外扩）的视觉尺寸必须 ≥ minPx。
 * 用于验证紧凑布局下关键控件确实由 .compact-control 保底到 44px，
 * 而不是靠命中区外扩掩盖「视觉已缩小到不可点」。
 */
export async function assertVisualSize(
  locator: Locator,
  label: string,
  minPx: number = responsive.minTouchTargetPx,
): Promise<void> {
  await expect(locator, `${label} 应可见`).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${label} 无 boundingBox`)
  expect(
    Math.min(box.width, box.height),
    `${label} 视觉尺寸应 ≥ ${minPx}px（实际 ${Math.min(box.width, box.height).toFixed(1)}px）`,
  ).toBeGreaterThanOrEqual(minPx - 0.5)
}

/** 密集控件（色板/表情/表格复选框）：视觉尺寸必须 ≥ minDenseTargetPx。 */
export async function assertDenseTarget(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} 应可见`).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${label} 无 boundingBox`)
  expect(
    Math.min(box.width, box.height),
    `${label} 视觉尺寸应 ≥ ${responsive.minDenseTargetPx}px（实际 ${Math.min(box.width, box.height).toFixed(1)}px）`,
  ).toBeGreaterThanOrEqual(responsive.minDenseTargetPx - 0.5)
}

/** 文本字号必须 ≥ minPx。 */
export async function assertFontAtLeast(
  locator: Locator,
  label: string,
  minPx: number,
): Promise<void> {
  await expect(locator, `${label} 应可见`).toBeVisible()
  const size = await locator.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  )
  expect(size, `${label} 字号应 ≥ ${minPx}px（实际 ${size.toFixed(1)}px）`).toBeGreaterThanOrEqual(
    minPx - 0.1,
  )
}

/** 元素必须完整落在舞台内（无被舞台边缘裁切）。 */
export async function assertWithinStage(
  page: Page,
  locator: Locator,
  label: string,
  tolerance = 1,
): Promise<void> {
  const stage = await stageRect(page)
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${label} 无 boundingBox`)
  expect(box.x, `${label} 左侧超出舞台`).toBeGreaterThanOrEqual(stage.left - tolerance)
  expect(box.y, `${label} 顶部超出舞台`).toBeGreaterThanOrEqual(stage.top - tolerance)
  expect(box.x + box.width, `${label} 右侧超出舞台`).toBeLessThanOrEqual(stage.right + tolerance)
  expect(box.y + box.height, `${label} 底部超出舞台`).toBeLessThanOrEqual(stage.bottom + tolerance)
}

/** 元素中心点不被其它元素遮挡（用于发现弹窗/横幅互相压盖）。 */
export async function assertNotOccluded(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} 应可见`).toBeVisible()
  const covered = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    if (!hit) return true
    return !(hit === element || element.contains(hit) || hit.contains(element))
  })
  expect(covered, `${label} 被其它元素遮挡`).toBe(false)
}

/**
 * 容器不得裁切内容：仅在容器该轴不可滚动时检查。
 * 可滚动（overflow auto/scroll）是紧凑布局允许的「局部滚动」策略，不算裁切。
 */
export async function assertNoOverflow(
  locator: Locator,
  label: string,
  tolerance = 2,
): Promise<void> {
  const result = await locator.evaluate((element) => {
    const style = getComputedStyle(element)
    const scrollable = (value: string) => value === 'auto' || value === 'scroll'
    return {
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollableY: scrollable(style.overflowY),
      scrollableX: scrollable(style.overflowX),
    }
  })
  if (!result.scrollableY)
    expect(
      result.scrollHeight - result.clientHeight,
      `${label} 纵向内容被裁切（scrollHeight ${result.scrollHeight} > clientHeight ${result.clientHeight}）`,
    ).toBeLessThanOrEqual(tolerance)
  if (!result.scrollableX)
    expect(
      result.scrollWidth - result.clientWidth,
      `${label} 横向内容被裁切（scrollWidth ${result.scrollWidth} > clientWidth ${result.clientWidth}）`,
    ).toBeLessThanOrEqual(tolerance)
}

/**
 * 记录某个界面的验收截图：同时落盘到测试产物目录并作为附件归档，
 * 便于人工复核「无裁切/无遮挡」的视觉效果（断言只覆盖尺寸与位置，观感仍需人眼确认）。
 */
export async function captureBaseline(
  page: Page,
  testInfo: TestInfo,
  baseline: Baseline,
  screen: string,
): Promise<void> {
  const name = `${screen}-${baseline.key}-${baseline.width}x${baseline.height}`
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

/** 舞台整体必须落在视口内且保持 16:9（不应出现整页滚动条）。 */
export async function assertStageFitsViewport(page: Page, baseline: Baseline): Promise<void> {
  const stage = await stageRect(page)
  expect(stage.width, `舞台宽度应 ≤ 视口宽度`).toBeLessThanOrEqual(baseline.width + 1)
  expect(stage.height, `舞台高度应 ≤ 视口高度`).toBeLessThanOrEqual(baseline.height + 1)
  expect(
    Math.abs(stage.width / stage.height - 16 / 9),
    `舞台应保持 16:9（实际 ${(stage.width / stage.height).toFixed(3)}）`,
  ).toBeLessThan(0.02)
}
