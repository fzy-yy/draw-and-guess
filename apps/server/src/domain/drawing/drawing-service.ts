import { APP_CONFIG } from '../../config/index.ts'
import { serverStrings } from '@draw-guess/strings'
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
import { GameError } from '../../errors.ts'
import type { GameSecret, PlayerSecret, RoomSecret } from '../../models.ts'
import { enforceEventRate } from '../../rate-limit.ts'
import { markAllSynced } from './canvas-sync.ts'
import {
  applyFill,
  applyStroke,
  clearCanvas,
  redoCommand,
  undoCommand,
  type DrawingBudget,
  type DrawingRejection,
} from './drawing-core.ts'
import type { RoomEventPorts, RuntimePorts } from '../shared-ports.ts'

/**
 * 画布预算：唯一来源是配置包（三档上限，见 packages/config/src/drawing.ts）。
 * 内核不读配置，预算由本层显式传入；接龙每幅画沿用同一套上限（S45）。
 */
export const DRAWING_BUDGET: DrawingBudget = {
  maxHistoryCommands: APP_CONFIG.drawing.maxHistoryCommands,
  maxPointsPerRound: APP_CONFIG.drawing.maxPointsPerRound,
  maxPointsPerStroke: APP_CONFIG.drawing.maxPointsPerStroke,
  maxFillsPerRound: APP_CONFIG.drawing.maxFillsPerRound,
}

/** 内核拒绝原因 → 协议错误码的唯一映射表（旧包的文案再按命令类型细分）。 */
const REJECTION_ERROR_CODES: Record<DrawingRejection, ErrorCode> = {
  'stale-sequence': ERROR_CODES.STALE_DRAW_EVENT,
  'invalid-style': ERROR_CODES.INVALID_DRAW_STYLE,
  'history-limit-reached': ERROR_CODES.DRAW_HISTORY_LIMIT_REACHED,
  'budget-exceeded': ERROR_CODES.DRAW_BUDGET_EXCEEDED,
}

/**
 * 发布策略：内核接受命令后「送给谁」的唯一出口（模式差异只在这里，见 S49）。
 * 经典＝全房广播（`createRoomBroadcastPublisher`）；接龙＝不广播，命令只留在链内权威历史里，
 * 由接龙的装配件注入一个静默实现（工单 04），本模块不预置接龙分支。
 */
export interface DrawingPublisher {
  publishStroke(payload: StrokePush): void
  publishFill(payload: FillPush): void
}

/** 经典发布策略：把已接受命令广播给房间内所有连接。 */
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
 * 绘图用例端口：时间与房间出口复用共享接口（见 domain/shared-ports.ts）。
 * `getSession` 解析目标画布（身份/回合/阶段门禁都在其中），`publisher` 是发布策略注入点。
 */
interface DrawingContext extends RuntimePorts, RoomEventPorts {
  getSession(
    playerId: string,
    roundId: string,
  ): {
    player: PlayerSecret
    room: RoomSecret
    game: GameSecret
  }
  publisher: DrawingPublisher
}

/** 把内核拒绝原因映射成协议错误；旧包文案按命令类型区分（笔画/填充各一条）。 */
function drawingError(reason: DrawingRejection, staleMessage: string): GameError {
  if (reason === 'stale-sequence') return new GameError(ERROR_CODES.STALE_DRAW_EVENT, staleMessage)
  return new GameError(REJECTION_ERROR_CODES[reason])
}

/**
 * 绘图命令用例：薄协调层——解析目标画布 → 执行纯函数内核（drawing-core.ts）→ 按注入的发布策略送出。
 * 序号单调、历史容量、三档预算与撤销栈等业务判定全部在内核里，本层不再重复裁决。
 */
export class DrawingService {
  constructor(private readonly context: DrawingContext) {}

  /** 追加一批笔画点：新命令或同一画笔的续接批次，成功后广播给房间。 */
  addStroke(playerId: string, roundId: string, stroke: Stroke): StrokeAck {
    const { player, room, game } = this.context.getSession(playerId, roundId)
    enforceEventRate(player, 'draw', this.context.clock)
    const decision = applyStroke(game, stroke, DRAWING_BUDGET)
    if (!decision.accepted)
      throw drawingError(decision.reason, serverStrings.errors.STALE_DRAW_EVENT_STROKE)
    // 权威历史已前移：全员差分游标推进到最后序号，否则成员会被判为「已同步」而漏掉本条命令。
    markAllSynced(room, game.lastSequence)
    this.context.publisher.publishStroke({
      roomId: room.id,
      gameId: game.id,
      roundId,
      stroke: decision.value.command,
      drawingRevision: game.drawingRevision,
    })
    return {
      strokeId: stroke.id,
      pointCount: decision.value.pointCount,
      drawingRevision: game.drawingRevision,
      remainingBudget: decision.value.remainingBudget,
    }
  }

  /** 提交封闭区域填充；客户端只上传点击位置和颜色，不上传像素数据。 */
  addFill(playerId: string, roundId: string, fill: FillCommand): { drawingRevision: number } {
    const { player, room, game } = this.context.getSession(playerId, roundId)
    enforceEventRate(player, 'draw', this.context.clock)
    const decision = applyFill(game, fill, DRAWING_BUDGET)
    if (!decision.accepted)
      throw drawingError(decision.reason, serverStrings.errors.STALE_DRAW_EVENT_FILL)
    markAllSynced(room, game.lastSequence)
    this.context.publisher.publishFill({
      roomId: room.id,
      gameId: game.id,
      roundId,
      fill: decision.value.command,
      drawingRevision: game.drawingRevision,
    })
    return { drawingRevision: game.drawingRevision }
  }

  /** 撤销最近一条命令；有变化时刷新房间快照（画布变化只经快照下发）。 */
  undo(playerId: string, roundId: string): void {
    const { player, room, game } = this.context.getSession(playerId, roundId)
    enforceEventRate(player, 'draw', this.context.clock)
    if (undoCommand(game)) this.context.emitRoom(room.id)
  }

  /** 重做最近一条被撤销的命令；有变化时刷新房间快照。 */
  redo(playerId: string, roundId: string): void {
    const { player, room, game } = this.context.getSession(playerId, roundId)
    enforceEventRate(player, 'draw', this.context.clock)
    if (redoCommand(game)) this.context.emitRoom(room.id)
  }

  /** 清空画布（历史、预算与撤销栈一起重置）；有变化时刷新房间快照。 */
  clear(playerId: string, roundId: string): void {
    const { player, room, game } = this.context.getSession(playerId, roundId)
    enforceEventRate(player, 'draw', this.context.clock)
    if (clearCanvas(game)) this.context.emitRoom(room.id)
  }
}
