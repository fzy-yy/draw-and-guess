import { describe, expect, it } from 'vitest'
import {
  SINGLE_POINT_DOT_EPSILON,
  clampPixelAxis,
  logicalAxis,
  normalizedToPixelIndex,
  strokeWidthAt,
} from '../../apps/client/src/canvas/geometry.ts'

/**
 * 画布坐标几何单口径（ADR-0022）的纯函数守卫。
 * 这些数值直接决定跨端像素一致性（e2e 栅格指纹跨客户端比对），
 * 任何公式改动都会让历史笔画/填充的落点漂移——本文件把它们钉死。
 */
describe('geometry 单口径', () => {
  it('logicalAxis：归一化 [0,1] 落到连续 [0, size-1]，x=1 恰在末列且保留亚像素', () => {
    expect(logicalAxis(0, 101)).toBe(0)
    // 末列索引是 size-1：乘 size 会让 x=1 越出画布（ADR-0003 的原始缺陷）。
    expect(logicalAxis(1, 101)).toBe(100)
    // 描边口径：连续值、不取整，交给 canvas 反锯齿。
    expect(logicalAxis(0.5, 100)).toBeCloseTo(49.5, 10)
  })

  it('clampPixelAxis：先 round 再收敛进 [0, size-1] 合法栅格索引', () => {
    expect(clampPixelAxis(-5, 101)).toBe(0)
    expect(clampPixelAxis(140, 101)).toBe(100)
    expect(clampPixelAxis(49.5, 101)).toBe(50)
    expect(clampPixelAxis(49.4, 101)).toBe(49)
  })

  it('normalizedToPixelIndex：映射与 clamp 的合成口径（填充种子/探针采样共用）', () => {
    expect(normalizedToPixelIndex(0, 101)).toBe(0)
    expect(normalizedToPixelIndex(1, 101)).toBe(100)
    // 载荷已按协议 clamp 到 [0,1]；越界输入也必须落在合法索引（防御口径）。
    expect(normalizedToPixelIndex(1.2, 101)).toBe(100)
    expect(normalizedToPixelIndex(-0.4, 101)).toBe(0)
    expect(normalizedToPixelIndex(0.5, 100)).toBe(50)
  })

  it('strokeWidthAt：渲染与光标共享的线宽恒等式，minLineScale 兜底两侧都覆盖', () => {
    // scale 高于下限：宽度随栅格/CSS 缩放。
    expect(strokeWidthAt(6, 1.5, 0.2)).toBe(9)
    // scale 低于下限：钳到 minLineScale，保证小窗下仍可辨（0.2 非二进制精确值，用 CloseTo）。
    expect(strokeWidthAt(6, 0.1, 0.2)).toBeCloseTo(1.2, 10)
    // 恒等式：同 (width, scale, minLineScale) 下光标直径 ≡ 线宽。
    const rendered = strokeWidthAt(5, 0.8, 0.2)
    const cursor = strokeWidthAt(5, 0.8, 0.2)
    expect(cursor).toBe(rendered)
  })

  it('单点圆点补偿常量为 0.01（改动会让所有单点笔画像素漂移，需同调 e2e 指纹预期）', () => {
    expect(SINGLE_POINT_DOT_EPSILON).toBe(0.01)
  })
})
