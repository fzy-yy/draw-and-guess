/**
 * 画布测试数据替身：标准笔画与填充命令的形状只在此定义，
 * 供组件级（GameCanvas）与状态机级（DrawingReplayMachine）spec 共用，
 * 避免复制同一份 UUID、点列与样式；画布 2D 上下文替身因两侧依赖不同的
 * canvas 身份与取像行为，仍各自保留。
 */
import type { FillCommand, Stroke } from '@draw-guess/shared'

/** 单笔标准笔画（两段点、五号笔宽、UUID …a1）；overrides 可覆盖任意字段。 */
export function makeStroke(overrides: Partial<Stroke> = {}): Stroke {
  return {
    kind: 'stroke',
    id: '00000000-0000-4000-8000-0000000000a1',
    tool: 'pen',
    color: '#1F2937',
    width: 5,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.5 },
    ],
    sequence: 1,
    startPointIndex: 0,
    ...overrides,
  }
}

/** 标准填充命令（UUID …b1、中心点、红色）；sequence 默认 1，调用方可覆盖。 */
export function makeFill(overrides: Partial<FillCommand> = {}): FillCommand {
  return {
    kind: 'fill',
    id: '00000000-0000-4000-8000-0000000000b1',
    point: { x: 0.5, y: 0.5 },
    color: '#EF4444',
    sequence: 1,
    ...overrides,
  }
}
