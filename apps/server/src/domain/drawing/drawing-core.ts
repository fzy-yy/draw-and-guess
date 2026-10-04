/**
 * 绘图纯函数内核：决定「自由笔画与区域填充如何进入权威画布历史」。
 *
 * 绘图历史的不变量全部只写在本模块（经典与接龙共用同一实现，见 S49 / S44）：
 * 序号严格单调、历史只增不删、命令数/点数/填充次数三档预算、撤销栈、重做、清空与修订代次单调。
 *
 * 纪律：本模块不 import 房间/成员/传输/日志/配置，只依赖协议类型与规范化纯函数；
 * 状态转移只发生在传入的画布状态上（画布仍留在领域模型，快照与差分游标直接读写它），
 * 因此单测可直接构造状态断言，无需拉起整机。画布同步游标（member.lastSyncedSeq）不在这里，
 * 它归协调层，见 canvas-sync.ts；发布策略同理，见 drawing-service.ts 的 DrawingPublisher。
 */
import {
  normalizeHexColor,
  type DrawingCommand,
  type FillCommand,
  type Stroke,
} from '@draw-guess/shared'

/**
 * 内核需要的最小画布状态面：领域模型的 `GameSecret` 与接龙链画布都结构上满足它。
 * 每幅画独立一套计数（命令数即 `strokes.length`、点数与填充次数各自累计）。
 */
export interface DrawingCanvasState {
  /** 自由笔画与区域填充共用的权威命令历史（只增不删；撤销只记录在撤销栈里）。 */
  strokes: DrawingCommand[]
  /** 已撤销命令 ID 栈（先进后出）；新命令落地时整体作废。 */
  undoneStrokeIds: string[]
  /** 已接受的最大绘图序号：小于等于它的命令按旧包拒绝。 */
  lastSequence: number
  /** 已累计点数（一次填充按 1 个点计）。 */
  strokePointTotal: number
  /** 已提交的填充命令数。 */
  fillCount: number
  /** 画布修订代次：每次写入（含撤销/重做/清空）单调递增。 */
  drawingRevision: number
}

/** 画布预算：由协调层从配置包取值传入（内核不读配置，接龙每幅画沿用同一套上限）。 */
export interface DrawingBudget {
  maxHistoryCommands: number
  maxPointsPerRound: number
  maxPointsPerStroke: number
  maxFillsPerRound: number
}

/** 内核拒绝原因：领域原因，协议错误码与文案的映射归协调层（见 drawing-service.ts）。 */
export type DrawingRejection =
  /** 命令序号未前进：旧包或重复包。 */
  | 'stale-sequence'
  /** 续接批次的工具/线宽/颜色/起点与既有命令不一致，或新命令起点不在 0。 */
  | 'invalid-style'
  /** 命令数达到上限（ADR-0010：拒绝新增，绝不丢弃最旧命令）。 */
  | 'history-limit-reached'
  /** 超过点数或填充次数预算。 */
  | 'budget-exceeded'

/** 内核裁决：接受时携带协调层需要的应答数据，拒绝时只带原因。 */
export type DrawingDecision<T> =
  { accepted: true; value: T } | { accepted: false; reason: DrawingRejection }

/** 被接受的笔画：command 用于发布（续接批次只含本次新增点，与既有实现一致）。 */
export interface AcceptedStroke {
  command: Stroke
  /** 该命令（含续接后的累计）点数：ack 的 pointCount 口径。 */
  pointCount: number
  /** 剩余点数预算（下限 0）。 */
  remainingBudget: number
}

/** 被接受的填充：command 为规范化后的命令，用于写入历史与发布。 */
export interface AcceptedFill {
  command: FillCommand
}

/** 释放一条命令占用的预算：笔画按点数，一次填充按「1 点 + 1 次填充」。 */
function releaseCommandBudget(canvas: DrawingCanvasState, command: DrawingCommand): void {
  if (command.kind === 'stroke') {
    canvas.strokePointTotal -= command.points.length
    return
  }
  canvas.strokePointTotal -= 1
  canvas.fillCount -= 1
}

/**
 * 作废撤销栈：新命令一旦落地，被撤销的命令就不可能再重做，必须连同其预算从历史里剔除。
 * 这一步必须在容量守卫**之前**执行，否则「撤销释放名额」失效（见 ADR-0010）。
 */
function discardUndone(canvas: DrawingCanvasState): void {
  if (!canvas.undoneStrokeIds.length) return
  const undone = new Set(canvas.undoneStrokeIds)
  for (const command of canvas.strokes) {
    if (undone.has(command.id)) releaseCommandBudget(canvas, command)
  }
  canvas.strokes = canvas.strokes.filter((command) => !undone.has(command.id))
  canvas.undoneStrokeIds = []
}

/** 接受一条笔画批次（新命令或续接批次）。 */
export function applyStroke(
  canvas: DrawingCanvasState,
  stroke: Stroke,
  budget: DrawingBudget,
): DrawingDecision<AcceptedStroke> {
  // 序号必须严格前进：旧包/重复包一律拒绝，且不触碰任何画布状态。
  if (stroke.sequence <= canvas.lastSequence) return { accepted: false, reason: 'stale-sequence' }
  // 颜色规范化只做大小写统一；格式与范围由协议 Schema 在绑定层裁决（与既有实现一致）。
  const color = normalizeHexColor(stroke.color)
  discardUndone(canvas)
  const existing = canvas.strokes.find(
    (candidate): candidate is Stroke => candidate.kind === 'stroke' && candidate.id === stroke.id,
  )
  // 续接批次必须与既有命令风格一致且严丝合缝（起点等于已有点数）；整笔新命令只能从 0 起笔。
  if (existing) {
    if (
      existing.tool !== stroke.tool ||
      existing.width !== stroke.width ||
      existing.color !== color ||
      stroke.startPointIndex !== existing.points.length
    )
      return { accepted: false, reason: 'invalid-style' }
  } else if (stroke.startPointIndex !== undefined && stroke.startPointIndex !== 0) {
    return { accepted: false, reason: 'invalid-style' }
  }

  const nextPointTotal = canvas.strokePointTotal + stroke.points.length
  // 续接批次只给已有命令补点，不占新命令名额；新命令先判历史容量，再判点数/单笔预算。
  if (!existing && canvas.strokes.length >= budget.maxHistoryCommands)
    return { accepted: false, reason: 'history-limit-reached' }
  if (
    nextPointTotal > budget.maxPointsPerRound ||
    (existing?.points.length ?? 0) + stroke.points.length > budget.maxPointsPerStroke
  )
    return { accepted: false, reason: 'budget-exceeded' }

  canvas.lastSequence = stroke.sequence
  canvas.strokePointTotal = nextPointTotal
  if (existing) {
    existing.points.push(...stroke.points)
    existing.sequence = stroke.sequence
  } else {
    // 历史存副本（避免与调用方共享可变数组），发布的 command 仍引用本次批次的点。
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

/** 接受一条区域填充命令（总是新增一条命令）。 */
export function applyFill(
  canvas: DrawingCanvasState,
  fill: FillCommand,
  budget: DrawingBudget,
): DrawingDecision<AcceptedFill> {
  if (fill.sequence <= canvas.lastSequence) return { accepted: false, reason: 'stale-sequence' }
  // 颜色格式由协议 Schema 裁决（与笔画同一条 colorPattern），此处只做大小写规范化。
  const color = normalizeHexColor(fill.color)
  discardUndone(canvas)
  // 填充与笔画共用同一条历史与点数预算，另加一道填充次数预算（限制重连全量重放成本）。
  if (canvas.strokes.length >= budget.maxHistoryCommands)
    return { accepted: false, reason: 'history-limit-reached' }
  if (
    canvas.strokePointTotal + 1 > budget.maxPointsPerRound ||
    canvas.fillCount + 1 > budget.maxFillsPerRound
  )
    return { accepted: false, reason: 'budget-exceeded' }

  canvas.lastSequence = fill.sequence
  canvas.strokePointTotal += 1
  canvas.fillCount += 1
  canvas.strokes.push({ ...fill, color })
  canvas.drawingRevision += 1
  return { accepted: true, value: { command: { ...fill, color } } }
}

/**
 * 撤销最近一条未被撤销的命令；返回是否发生撤销。
 * 撤销只把命令 ID 记账进撤销栈（历史仍保留，重做才有依据），因此不动序号与预算。
 */
export function undoCommand(canvas: DrawingCanvasState): boolean {
  const undone = new Set(canvas.undoneStrokeIds)
  const target = [...canvas.strokes].reverse().find((command) => !undone.has(command.id))
  if (!target) return false
  canvas.undoneStrokeIds.push(target.id)
  canvas.drawingRevision += 1
  return true
}

/** 重做最近一条被撤销的命令；返回是否发生重做（撤销栈为空时无变化）。 */
export function redoCommand(canvas: DrawingCanvasState): boolean {
  if (!canvas.undoneStrokeIds.length) return false
  canvas.undoneStrokeIds.pop()
  canvas.drawingRevision += 1
  return true
}

/**
 * 清空画布：重置历史与三档预算计数，并推进序号——序号前移让客户端在途的旧包作废，
 * 也使下一份快照必然整帧下发（差分游标追不上新序号）。空画布清空为无变化。
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
