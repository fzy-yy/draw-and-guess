/**
 * 绘图命令处理与广播协调领域服务。
 *
 * 遵循《后端架构规范》R3.2 与 R4.3：
 * 1. 薄协调层：解析目标会话 → 执行纯函数内核（drawing-core.ts）→ 按注入的发布策略送出；
 * 2. 错误全量采用 AppError 抛出；
 * 3. 区分经典全房广播与接龙静默写入策略。
 */
import { APP_CONFIG } from '../../core/config.ts'
import { serverErrorMessages, serverStrings } from '@draw-guess/strings'
import {
  ERROR_CODES,
  EVENTS,
  createServerPush,
  type ErrorCode,
  type FillCommand,
  type FillPush,
  type Stroke,
  type StrokeAck,
  type StrokePush,
} from '@draw-guess/shared'
import { GameError } from '../../core/errors.ts'
import type { PlayerSecret } from '../../models.ts'
import { enforceEventRate } from '../../rate-limit.ts'
import type { Clock } from '../../core/runtime.ts'
import {
  applyFill,
  applyStroke,
  clearCanvas,
  redoCommand,
  undoCommand,
  type DrawingBudget,
  type DrawingCanvasState,
  type DrawingRejection,
} from './drawing-core.ts'
import type { RoomEventPorts } from '../../domain/shared-ports.ts'

/**
 * 画布预算限制规则。
 */
export const DRAWING_BUDGET: DrawingBudget = {
  maxHistoryCommands: APP_CONFIG.drawing.maxHistoryCommands,
  maxPointsPerRound: APP_CONFIG.drawing.maxPointsPerRound,
  maxPointsPerStroke: APP_CONFIG.drawing.maxPointsPerStroke,
  maxFillsPerRound: APP_CONFIG.drawing.maxFillsPerRound,
}

/** 内核拒绝原因 → 协议错误码映射表 */
const REJECTION_ERROR_CODES: Record<DrawingRejection, ErrorCode> = {
  'stale-sequence': ERROR_CODES.STALE_DRAW_EVENT,
  'invalid-style': ERROR_CODES.INVALID_DRAW_STYLE,
  'history-limit-reached': ERROR_CODES.DRAW_HISTORY_LIMIT_REACHED,
  'budget-exceeded': ERROR_CODES.DRAW_BUDGET_EXCEEDED,
}

/**
 * 目标解析拒绝原因（领域语汇）：只表达「为什么不能画」，错误码由本服务统一映射。
 *
 * 归属理由见 docs/adr/0064-single-backend-assembly.md：拒绝语义属于命令用例，
 * 不属于装配根——否则同一件事会在装配根、网关与两份会话解析器里各说一遍。
 */
export type DrawingTargetRejection =
  | 'no-game'
  | 'not-drawer'
  | 'not-participant'
  | 'stale-target'
  | 'already-submitted'
  | 'phase-expired'

/** 目标解析结果：会话或拒绝原因，调用方不再用异常表达「没资格画」。 */
export type DrawingTargetDecision =
  | { readonly accepted: true; readonly session: DrawingSession }
  | { readonly accepted: false; readonly reason: DrawingTargetRejection }

/** 目标拒绝 → 协议错误码与状态码（唯一映射处）。 */
const TARGET_REJECTION_RESPONSES: Record<
  DrawingTargetRejection,
  { code: ErrorCode; status: number }
> = {
  'no-game': { code: ERROR_CODES.NO_GAME, status: 409 },
  'not-drawer': { code: ERROR_CODES.NOT_DRAWER, status: 403 },
  'not-participant': { code: ERROR_CODES.NOT_DRAWER, status: 403 },
  'stale-target': { code: ERROR_CODES.STALE_DRAW_EVENT, status: 409 },
  'already-submitted': { code: ERROR_CODES.ALREADY_SUBMITTED, status: 409 },
  'phase-expired': { code: ERROR_CODES.PHASE_EXPIRED, status: 410 },
}

/**
 * 拒绝一律用 GameError 表达：binder 只把非 GameError 记成「未预期错误」，
 * 预期内的拒绝（迟到笔画、越权、阶段过期）不该污染错误日志。
 */
function drawingError(reason: DrawingRejection, staleMessage: string): GameError {
  if (reason === 'stale-sequence') {
    return new GameError(ERROR_CODES.STALE_DRAW_EVENT, staleMessage, undefined, 409)
  }
  const code = REJECTION_ERROR_CODES[reason]
  return new GameError(code, serverErrorMessages[code], undefined, 422)
}

/** 目标拒绝的可读文案：过期用调用方给的按操作文案，其余用错误码默认文案。 */
function targetRejectionError(reason: DrawingTargetRejection, staleMessage: string): GameError {
  const { code, status } = TARGET_REJECTION_RESPONSES[reason]
  const message =
    reason === 'stale-target'
      ? staleMessage
      : (serverErrorMessages[code] ?? serverStrings.errors.STALE_DRAWING_CONTEXT)
  return new GameError(code, message, undefined, status)
}

/**
 * 发布策略接口契约：接受命令后决定下发给谁。
 */
export interface DrawingPublisher {
  publishStroke(payload: StrokePush): void
  publishFill(payload: FillPush): void
}

/**
 * 经典模式发布策略：把命令全量广播给房间内所有成员。
 */
export function createRoomBroadcastPublisher(
  ports: Pick<RoomEventPorts, 'emitRoomEvent'>,
): DrawingPublisher {
  return {
    publishStroke: (payload) =>
      ports.emitRoomEvent(
        payload.roomId,
        EVENTS.drawStrokeBatch,
        createServerPush(EVENTS.drawStrokeBatch, payload),
      ),
    publishFill: (payload) =>
      ports.emitRoomEvent(
        payload.roomId,
        EVENTS.drawFillCommit,
        createServerPush(EVENTS.drawFillCommit, payload),
      ),
  }
}

/**
 * 静默发布策略（接龙模式使用：命令只写入链内权威历史，不向全房广播）。
 */
export function createSilentPublisher(): DrawingPublisher {
  return {
    publishStroke(): void {},
    publishFill(): void {},
  }
}

/**
 * 绘图会话上下文抽象：解耦经典回合与接龙分段画作。
 */
export interface DrawingSession {
  player: PlayerSecret
  canvas: DrawingCanvasState
  roomId: string
  gameId: string
  roundId: string
  markSynced(): void
  refreshRoom(): void
}

/**
 * 绘图协调器上下文依赖契约。
 */
export interface DrawingContext {
  clock: Clock
  /** 解析「这次绘图命令作用于哪块画布」；拒绝以返回值表达，不以异常表达（ADR-0064）。 */
  resolveSession(playerId: string, targetId: string): DrawingTargetDecision
  publisher: DrawingPublisher
}

/**
 * 绘图领域服务。
 */
export class DrawingService {
  constructor(private readonly context: DrawingContext) {}

  /** 解析目标会话；被拒绝时抛出带稳定错误码的业务错误（唯一映射处）。 */
  private requireSession(playerId: string, targetId: string, staleMessage: string): DrawingSession {
    const decision = this.context.resolveSession(playerId, targetId)
    if (decision.accepted) return decision.session
    throw targetRejectionError(decision.reason, staleMessage)
  }

  addStroke(playerId: string, targetId: string, stroke: Stroke): StrokeAck {
    const session = this.requireSession(
      playerId,
      targetId,
      serverStrings.errors.STALE_DRAW_EVENT_STROKE,
    )
    enforceEventRate(session.player, 'draw', this.context.clock)
    const decision = applyStroke(session.canvas, stroke, DRAWING_BUDGET)
    if (!decision.accepted) {
      throw drawingError(decision.reason, serverStrings.errors.STALE_DRAW_EVENT_STROKE)
    }

    session.markSynced()
    this.context.publisher.publishStroke({
      roomId: session.roomId,
      gameId: session.gameId,
      roundId: session.roundId,
      stroke: decision.value.command,
      drawingRevision: session.canvas.drawingRevision,
    })

    return {
      strokeId: stroke.id,
      pointCount: decision.value.pointCount,
      drawingRevision: session.canvas.drawingRevision,
      remainingBudget: decision.value.remainingBudget,
    }
  }

  addFill(playerId: string, targetId: string, fill: FillCommand): { drawingRevision: number } {
    const session = this.requireSession(
      playerId,
      targetId,
      serverStrings.errors.STALE_DRAW_EVENT_FILL,
    )
    enforceEventRate(session.player, 'draw', this.context.clock)
    const decision = applyFill(session.canvas, fill, DRAWING_BUDGET)
    if (!decision.accepted) {
      throw drawingError(decision.reason, serverStrings.errors.STALE_DRAW_EVENT_FILL)
    }

    session.markSynced()
    this.context.publisher.publishFill({
      roomId: session.roomId,
      gameId: session.gameId,
      roundId: session.roundId,
      fill: decision.value.command,
      drawingRevision: session.canvas.drawingRevision,
    })

    return { drawingRevision: session.canvas.drawingRevision }
  }

  undo(playerId: string, targetId: string): void {
    const session = this.requireSession(
      playerId,
      targetId,
      serverStrings.errors.STALE_DRAW_EVENT_STROKE,
    )
    enforceEventRate(session.player, 'draw', this.context.clock)
    if (undoCommand(session.canvas)) {
      session.refreshRoom()
    }
  }

  redo(playerId: string, targetId: string): void {
    const session = this.requireSession(
      playerId,
      targetId,
      serverStrings.errors.STALE_DRAW_EVENT_STROKE,
    )
    enforceEventRate(session.player, 'draw', this.context.clock)
    if (redoCommand(session.canvas)) {
      session.refreshRoom()
    }
  }

  clear(playerId: string, targetId: string): void {
    const session = this.requireSession(
      playerId,
      targetId,
      serverStrings.errors.STALE_DRAW_EVENT_STROKE,
    )
    enforceEventRate(session.player, 'draw', this.context.clock)
    if (clearCanvas(session.canvas)) {
      session.refreshRoom()
    }
  }
}
