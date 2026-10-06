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
import { AppError } from '../../core/errors.ts'
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

function drawingError(reason: DrawingRejection, staleMessage: string): AppError {
  if (reason === 'stale-sequence') {
    return new AppError({
      message: staleMessage,
      code: ERROR_CODES.STALE_DRAW_EVENT,
      status: 409,
    })
  }
  const code = REJECTION_ERROR_CODES[reason]
  return new AppError({
    message: serverErrorMessages[code],
    code,
    status: 422,
  })
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
  getSession(playerId: string, targetId: string): DrawingSession
  publisher: DrawingPublisher
}

/**
 * 绘图领域服务。
 */
export class DrawingService {
  constructor(private readonly context: DrawingContext) {}

  addStroke(playerId: string, targetId: string, stroke: Stroke): StrokeAck {
    const session = this.context.getSession(playerId, targetId)
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
    const session = this.context.getSession(playerId, targetId)
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
    const session = this.context.getSession(playerId, targetId)
    enforceEventRate(session.player, 'draw', this.context.clock)
    if (undoCommand(session.canvas)) {
      session.refreshRoom()
    }
  }

  redo(playerId: string, targetId: string): void {
    const session = this.context.getSession(playerId, targetId)
    enforceEventRate(session.player, 'draw', this.context.clock)
    if (redoCommand(session.canvas)) {
      session.refreshRoom()
    }
  }

  clear(playerId: string, targetId: string): void {
    const session = this.context.getSession(playerId, targetId)
    enforceEventRate(session.player, 'draw', this.context.clock)
    if (clearCanvas(session.canvas)) {
      session.refreshRoom()
    }
  }
}
