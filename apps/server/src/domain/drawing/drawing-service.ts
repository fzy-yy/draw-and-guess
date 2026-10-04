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
import type { PlayerSecret } from '../../models.ts'
import { enforceEventRate } from '../../rate-limit.ts'
import type { RuntimeDependencies } from '../../runtime.ts'
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
import type { RoomEventPorts } from '../shared-ports.ts'

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
 * 绘图会话：一次绘图命令的作用目标（模式差异全部由装配层的解析端口给出，见 S49）。
 *
 * 经典会话由 `GameService.getDrawingSession` 构造：画布＝本局 `GameSecret`，
 * 命令落地后推进全员差分游标，撤销 / 重做 / 清空后刷新房间快照。
 * 接龙会话由 `GameService` 的接龙解析构造：画布＝本棒链的一幅画布，
 * 两个房间级副作用都是 no-op——接龙本棒期间对房间零推送（S2）。
 * 结构上与内核的 `DrawingCanvasState` 相容，因此同一套内核代码直接吃两种会话。
 */
export interface DrawingSession {
  /** 请求者身份（身份 / 回合 / 阶段门禁已在解析端口内完成）。 */
  player: PlayerSecret
  /** 内核唯一写入的权威画布。 */
  canvas: DrawingCanvasState
  /** 推送载荷的房间 id（经典与接龙都用得上，接龙的推送永远不发送）。 */
  roomId: string
  /** 推送载荷的对局 id：经典＝本局，接龙＝接龙局。 */
  gameId: string
  /** 推送载荷的回合 / 步骤 id：经典＝回合 id，接龙＝步骤 id（对位协议字段）。 */
  roundId: string
  /** 命令落地后推进画布差分游标：经典必须推进，否则成员快照会漏发本条命令；接龙为 no-op。 */
  markSynced(): void
  /** 撤销 / 重做 / 清空后的房间级刷新：经典刷新房间快照；接龙为零推送 no-op。 */
  refreshRoom(): void
}

/**
 * 绘图用例端口：时间（事件级限频）+ 目标解析 + 发布策略。
 * 两个实现按模式注入：经典＝本局画布 + 全房广播发布；接龙＝本棒链画布 + 静默发布（S2 / S49）。
 */
interface DrawingContext {
  clock: RuntimeDependencies['clock']
  getSession(playerId: string, targetId: string): DrawingSession
  publisher: DrawingPublisher
}

/** 把内核拒绝原因映射成协议错误；旧包文案按命令类型区分（笔画/填充各一条）。 */
function drawingError(reason: DrawingRejection, staleMessage: string): GameError {
  if (reason === 'stale-sequence') return new GameError(ERROR_CODES.STALE_DRAW_EVENT, staleMessage)
  return new GameError(REJECTION_ERROR_CODES[reason])
}

/**
 * 绘图命令用例：薄协调层——解析目标会话 → 执行纯函数内核（drawing-core.ts）→ 按注入的发布策略送出。
 * 序号单调、历史容量、三档预算与撤销栈等业务判定全部在内核里，本层不再重复裁决；
 * 模式差异（画布目标、发布出口、房间级同步）全部由 `DrawingSession` 与发布策略承担。
 * `targetId` 即事件里的目标标识：经典＝回合 id，接龙＝步骤 id。
 */
export class DrawingService {
  constructor(private readonly context: DrawingContext) {}

  /** 追加一批笔画点：新命令或同一画笔的续接批次，成功后按注入策略发布。 */
  addStroke(playerId: string, targetId: string, stroke: Stroke): StrokeAck {
    const session = this.context.getSession(playerId, targetId)
    enforceEventRate(session.player, 'draw', this.context.clock)
    const decision = applyStroke(session.canvas, stroke, DRAWING_BUDGET)
    if (!decision.accepted)
      throw drawingError(decision.reason, serverStrings.errors.STALE_DRAW_EVENT_STROKE)
    // 权威历史已前移：经典必须把全员差分游标推进到最后序号，否则成员会被判为「已同步」
    // 而漏掉本条命令；接龙的会话在这里是 no-op（画布随下一棒快照整幅下发）。
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

  /** 提交封闭区域填充；客户端只上传点击位置和颜色，不上传像素数据。 */
  addFill(playerId: string, targetId: string, fill: FillCommand): { drawingRevision: number } {
    const session = this.context.getSession(playerId, targetId)
    enforceEventRate(session.player, 'draw', this.context.clock)
    const decision = applyFill(session.canvas, fill, DRAWING_BUDGET)
    if (!decision.accepted)
      throw drawingError(decision.reason, serverStrings.errors.STALE_DRAW_EVENT_FILL)
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

  /** 撤销最近一条命令；有变化时按会话刷新房间（经典＝快照，接龙＝零推送）。 */
  undo(playerId: string, targetId: string): void {
    const session = this.context.getSession(playerId, targetId)
    enforceEventRate(session.player, 'draw', this.context.clock)
    if (undoCommand(session.canvas)) session.refreshRoom()
  }

  /** 重做最近一条被撤销的命令；有变化时按会话刷新房间。 */
  redo(playerId: string, targetId: string): void {
    const session = this.context.getSession(playerId, targetId)
    enforceEventRate(session.player, 'draw', this.context.clock)
    if (redoCommand(session.canvas)) session.refreshRoom()
  }

  /** 清空画布（历史、预算与撤销栈一起重置）；有变化时按会话刷新房间。 */
  clear(playerId: string, targetId: string): void {
    const session = this.context.getSession(playerId, targetId)
    enforceEventRate(session.player, 'draw', this.context.clock)
    if (clearCanvas(session.canvas)) session.refreshRoom()
  }
}
