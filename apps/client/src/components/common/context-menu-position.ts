/*
 * 右键菜单定位纯函数：把「指针落点」换算成菜单面板在定位上下文内的最终偏移。
 * 独立成普通模块（同 dialog-stack.ts）是为了让边界矩阵可以脱离 DOM 单测。
 */

/** 菜单面板与舞台边界之间的最小留白（px 下限）：低高度舞台下仍保留可辨识间距。 */
export const CONTEXT_MENU_EDGE_GAP = 8

/** 留白随舞台高度等比放大（0.02 ≈ 2cqh）：与舞台圆角、整体留白同步，大屏全屏下不贴边。 */
const CONTEXT_MENU_EDGE_GAP_RATIO = 0.02

/** 定位上下文内的坐标（左上角原点）。 */
export interface ContextMenuOffset {
  left: number
  top: number
}

/** 指针落点，与菜单尺寸、边界同处一个坐标系（定位上下文内，单位为 px）。 */
export interface ContextMenuAnchor {
  x: number
  y: number
}

/** 矩形尺寸：菜单面板尺寸或舞台可用区域。 */
export interface ContextMenuSize {
  width: number
  height: number
}

/**
 * 单轴求解：默认从落点向右/向下展开，末端越界时翻转到落点左侧/上方（菜单右/下边缘对齐指针），
 * 翻转后仍越界（菜单大于可用区域）再夹取到留白内，保证返回值永远是合法偏移而非负值或 NaN。
 */
function resolveAxis(anchor: number, size: number, bound: number, gap: number): number {
  const overflowEnd = anchor + size + gap > bound
  const start = overflowEnd ? anchor - size : anchor
  const max = Math.max(gap, bound - size - gap)
  return Math.min(Math.max(start, gap), max)
}

/** 求解当前舞台高度下的实际留白：不小于 CONTEXT_MENU_EDGE_GAP。 */
export function resolveContextMenuGap(boundsHeight: number): number {
  return Math.max(CONTEXT_MENU_EDGE_GAP, Math.round(boundsHeight * CONTEXT_MENU_EDGE_GAP_RATIO))
}

/** 求解菜单面板相对定位上下文（游戏舞台）的最终偏移；留白缺省按舞台高度等比放大。 */
export function resolveContextMenuPosition(
  anchor: ContextMenuAnchor,
  menu: ContextMenuSize,
  bounds: ContextMenuSize,
  gap: number = resolveContextMenuGap(bounds.height),
): ContextMenuOffset {
  return {
    left: resolveAxis(anchor.x, menu.width, bounds.width, gap),
    top: resolveAxis(anchor.y, menu.height, bounds.height, gap),
  }
}
