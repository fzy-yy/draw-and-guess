import { describe, expect, it } from 'vitest'
import {
  CONTEXT_MENU_EDGE_GAP,
  resolveContextMenuGap,
  resolveContextMenuPosition,
} from '../../apps/client/src/components/common/context-menu-position.ts'

// 桌面基准舞台尺寸（见 packages/config/src/settings.ts 的 responsive.baselines）
const BOUNDS = { width: 1267, height: 713 }
const MENU = { width: 200, height: 300 }
// 桌面舞台高度下按 2cqh 放大的实际留白（713 × 0.02 = 14.26 → 14）
const GAP = resolveContextMenuGap(BOUNDS.height)

describe('右键菜单定位夹取', () => {
  it('空间充足时菜单从落点向右下展开', () => {
    expect(resolveContextMenuPosition({ x: 100, y: 80 }, MENU, BOUNDS)).toEqual({
      left: 100,
      top: 80,
    })
  })

  it('右侧越界时翻转到落点左侧，菜单右边缘对齐指针', () => {
    expect(resolveContextMenuPosition({ x: 1200, y: 80 }, MENU, BOUNDS)).toEqual({
      left: 1000,
      top: 80,
    })
  })

  it('下方越界时翻转到落点上方，菜单下边缘对齐指针', () => {
    expect(resolveContextMenuPosition({ x: 100, y: 600 }, MENU, BOUNDS)).toEqual({
      left: 100,
      top: 300,
    })
  })

  it('右下同时越界时两个方向都翻转', () => {
    // 下边缘翻到 y-高度 后仍越过留白，因此 top 被夹到 713-300-14
    expect(resolveContextMenuPosition({ x: 1200, y: 700 }, MENU, BOUNDS)).toEqual({
      left: 1000,
      top: 399,
    })
  })

  it('刚好贴边不翻转：末端恰好等于可用边界时仍从落点展开', () => {
    expect(
      resolveContextMenuPosition({ x: BOUNDS.width - MENU.width - GAP, y: 0 }, MENU, BOUNDS),
    ).toEqual({ left: BOUNDS.width - MENU.width - GAP, top: GAP })
  })

  it('落点越出舞台（负坐标）时夹取到留白内，不产生负偏移', () => {
    expect(resolveContextMenuPosition({ x: -40, y: -20 }, MENU, BOUNDS)).toEqual({
      left: GAP,
      top: GAP,
    })
  })

  it('菜单大于舞台时夹取到留白处而不是返回负值', () => {
    const oversize = { width: 1400, height: 800 }
    expect(resolveContextMenuPosition({ x: 50, y: 50 }, oversize, BOUNDS)).toEqual({
      left: GAP,
      top: GAP,
    })
  })

  it('留白可自定义，用于特殊舞台下收紧贴边距离', () => {
    expect(resolveContextMenuPosition({ x: -10, y: -10 }, MENU, BOUNDS, 2)).toEqual({
      left: 2,
      top: 2,
    })
  })
})

describe('右键菜单留白取值', () => {
  it('随舞台高度等比放大（≈2cqh）', () => {
    expect(resolveContextMenuGap(1080)).toBe(22)
    expect(resolveContextMenuGap(713)).toBe(14)
  })

  it('低高度舞台不低于像素下限', () => {
    expect(resolveContextMenuGap(386)).toBe(CONTEXT_MENU_EDGE_GAP)
    expect(resolveContextMenuGap(0)).toBe(CONTEXT_MENU_EDGE_GAP)
  })
})
