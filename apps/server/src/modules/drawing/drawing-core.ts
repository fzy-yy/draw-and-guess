/**
 * 绘图纯函数内核：决定自由笔画与区域填充如何进入权威画布历史。
 *
 * 遵循架构约定：
 * 1. 坐标与序号由调用方提供，序号单调递增，旧包严格拒绝；
 * 2. 笔画历史只增不减（ADR-0010：达容量上限拒绝新增，绝不丢弃最旧命令）；
 * 3. 严格核算三档预算（点数预算、单笔上限、填充次数上限）。
 */
import {
  normalizeHexColor,
  type DrawingCommand,
  type FillCommand,
  type Stroke,
} from '@draw-guess/shared'

/**
 * 最小画布状态面：经典 GameSecret 与接龙链画布均结构上满足此接口。
 */
export interface DrawingCanvasState {
  /** 命令历史列表 */
  strokes: DrawingCommand[]
  /** 已撤销的命令 ID 栈（后进先出） */
  undoneStrokeIds: string[]
  /** 最近一次接受的命令序号 */
  lastSequence: number
  /** 当前回合累计绘制的点数总和 */
  strokePointTotal: number
  /** 当前回合累计填充的次数总和 */
  fillCount: number
  /** 画布修订版本号（单调自增） */
  drawingRevision: number
}

/**
 * 画布预算限制规则。
 */
export interface DrawingBudget {
  /** 历史命令总条数硬性上限（默认 500） */
  maxHistoryCommands: number
  /** 单回合累计点数上限 */
  maxPointsPerRound: number
  /** 单笔批次点数上限 */
  maxPointsPerStroke: number
  /** 单回合填充次数上限 */
  maxFillsPerRound: number
}

/**
 * 内核拒绝原因枚举。
 */
export type DrawingRejection =
  'stale-sequence' | 'invalid-style' | 'history-limit-reached' | 'budget-exceeded'

/**
 * 内核处理决策返回值。
 */
export type DrawingDecision<T> =
  { accepted: true; value: T } | { accepted: false; reason: DrawingRejection }

/**
 * 成功接受的笔画指令包。
 */
export interface AcceptedStroke {
  command: Stroke
  pointCount: number
  remainingBudget: number
}

/**
 * 成功接受的填充指令包。
 */
export interface AcceptedFill {
  command: FillCommand
}

function releaseCommandBudget(canvas: DrawingCanvasState, command: DrawingCommand): void {
  if (command.kind === 'stroke') {
    canvas.strokePointTotal = Math.max(0, canvas.strokePointTotal - command.points.length)
  } else if (command.kind === 'fill') {
    canvas.strokePointTotal = Math.max(0, canvas.strokePointTotal - 1)
    canvas.fillCount = Math.max(0, canvas.fillCount - 1)
  }
}

function discardUndone(canvas: DrawingCanvasState): void {
  if (!canvas.undoneStrokeIds.length) return
  const undone = new Set(canvas.undoneStrokeIds)
  for (const command of canvas.strokes) {
    if (undone.has(command.id)) {
      releaseCommandBudget(canvas, command)
    }
  }
  canvas.strokes = canvas.strokes.filter((command) => !undone.has(command.id))
  canvas.undoneStrokeIds = []
}

/**
 * 应用笔画批次（新画笔或现有画笔续接）。
 */
export function applyStroke(
  canvas: DrawingCanvasState,
  stroke: Stroke,
  budget: DrawingBudget,
): DrawingDecision<AcceptedStroke> {
  if (stroke.sequence <= canvas.lastSequence) {
    return { accepted: false, reason: 'stale-sequence' }
  }

  const color = normalizeHexColor(stroke.color)
  discardUndone(canvas)

  const existing = canvas.strokes.find(
    (candidate): candidate is Stroke => candidate.kind === 'stroke' && candidate.id === stroke.id,
  )

  if (existing) {
    if (
      existing.tool !== stroke.tool ||
      existing.width !== stroke.width ||
      existing.color !== color ||
      stroke.startPointIndex !== existing.points.length
    ) {
      return { accepted: false, reason: 'invalid-style' }
    }
  } else if (stroke.startPointIndex !== undefined && stroke.startPointIndex !== 0) {
    return { accepted: false, reason: 'invalid-style' }
  }

  const nextPointTotal = canvas.strokePointTotal + stroke.points.length
  if (!existing && canvas.strokes.length >= budget.maxHistoryCommands) {
    return { accepted: false, reason: 'history-limit-reached' }
  }
  if (
    nextPointTotal > budget.maxPointsPerRound ||
    (existing?.points.length ?? 0) + stroke.points.length > budget.maxPointsPerStroke
  ) {
    return { accepted: false, reason: 'budget-exceeded' }
  }

  canvas.lastSequence = stroke.sequence
  canvas.strokePointTotal = nextPointTotal
  if (existing) {
    existing.points.push(...stroke.points)
    existing.sequence = stroke.sequence
  } else {
    canvas.strokes.push({ ...stroke, color, points: [...stroke.points] })
  }
  canvas.drawingRevision += 1

  return {
    accepted: true,
    value: {
      command: { ...stroke, color },
      pointCount: existing ? existing.points.length : stroke.points.length,
      remainingBudget: Math.max(0, budget.maxPointsPerRound - canvas.strokePointTotal),
    },
  }
}

/**
 * 应用洪泛区域填充。
 */
export function applyFill(
  canvas: DrawingCanvasState,
  fill: FillCommand,
  budget: DrawingBudget,
): DrawingDecision<AcceptedFill> {
  if (fill.sequence <= canvas.lastSequence) {
    return { accepted: false, reason: 'stale-sequence' }
  }

  const color = normalizeHexColor(fill.color)
  discardUndone(canvas)

  if (canvas.strokes.length >= budget.maxHistoryCommands) {
    return { accepted: false, reason: 'history-limit-reached' }
  }
  if (
    canvas.strokePointTotal + 1 > budget.maxPointsPerRound ||
    canvas.fillCount + 1 > budget.maxFillsPerRound
  ) {
    return { accepted: false, reason: 'budget-exceeded' }
  }

  canvas.lastSequence = fill.sequence
  canvas.strokePointTotal += 1
  canvas.fillCount += 1
  canvas.strokes.push({ ...fill, color })
  canvas.drawingRevision += 1

  return { accepted: true, value: { command: { ...fill, color } } }
}

/**
 * 撤销最近一条命令。
 */
export function undoCommand(canvas: DrawingCanvasState): boolean {
  const undone = new Set(canvas.undoneStrokeIds)
  const target = [...canvas.strokes].reverse().find((command) => !undone.has(command.id))
  if (!target) return false
  canvas.undoneStrokeIds.push(target.id)
  canvas.drawingRevision += 1
  return true
}

/**
 * 重做最近一条已撤销的命令。
 */
export function redoCommand(canvas: DrawingCanvasState): boolean {
  if (!canvas.undoneStrokeIds.length) return false
  canvas.undoneStrokeIds.pop()
  canvas.drawingRevision += 1
  return true
}

/**
 * 清空整张画布命令。
 */
export function clearCanvas(canvas: DrawingCanvasState): boolean {
  if (!canvas.strokes.length && !canvas.undoneStrokeIds.length) return false
  canvas.strokes = []
  canvas.undoneStrokeIds = []
  canvas.strokePointTotal = 0
  canvas.fillCount = 0
  canvas.lastSequence += 1
  canvas.drawingRevision += 1
  return true
}
