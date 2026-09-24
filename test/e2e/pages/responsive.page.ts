import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { responsive } from '../../../packages/config/src/settings.ts'

/**
 * 响应式缩放与可读验收断言辅助（供 specs/07-responsive-touch.spec.ts 使用）。
 *
 * 验收标准见 AGENTS.md「响应式与触控验收标准」章节，阈值唯一来源是 packages/config/src/settings.ts 的 responsive。
 * 这里只做「测量 + 断言」，不引入任何业务规则。
 */

/** 验收基准视口（桌面网页端单一基准）。 */
export const BASELINES = responsive.baselines

export type Baseline = (typeof BASELINES)[number]

/** 把视口切到某个基准。 */
export async function applyBaseline(page: Page, baseline: Baseline): Promise<void> {
  await page.setViewportSize({ width: baseline.width, height: baseline.height })
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

/**
 * 控件高度与舞台高度的比值（等比缩放验收核心）。
 * 显式以 cqh 定高的控件（如 NetworkStatusButton 的 h-[4.4cqh]）在任意基准下比值应恒定；
 * 若控件被像素保底钉住（旧 44px 触控契约），小基准下比值会显著偏大——该断言即回归守卫。
 */
export async function heightRatioToStage(page: Page, locator: Locator): Promise<number> {
  const stage = await stageRect(page)
  const box = await locator.boundingBox()
  if (!box) throw new Error('控件无 boundingBox，无法测量')
  return box.height / stage.height
}

/** 密集控件（色板/表情/表格与筛选复选框）：视觉尺寸必须 ≥ minDenseTargetPx。 */
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
