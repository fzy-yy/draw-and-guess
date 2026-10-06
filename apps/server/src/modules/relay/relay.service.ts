/**
 * 接龙对局流程编排领域服务。
 *
 * 遵循《后端架构规范》R3.2 与 R4.3：
 * 1. 负责四步流转提交（作画锁定、猜词提交）、复盘投票与独立聊天；
 * 2. 协调 RelayMachine 推进状态机；
 * 3. 错误全量采用 AppError 抛出。
 */
import type { RelayVoteChoice, Stroke, StrokeAck, FillCommand } from '@draw-guess/shared'
import type { MemberState, PlayerSecret, RoomSecret } from '../../models.ts'
import type { RelayGameSecret } from '../../domain/relay/relay-models.ts'
import type { RelayMachine } from '../../domain/relay/relay-machine.ts'
import type { DrawingService } from '../drawing/drawing.service.ts'
import type { Clock } from '../../core/runtime.ts'
import { enforceEventRate } from '../../rate-limit.ts'

export interface RelayServiceContext {
  clock: Clock
  relayMachine: RelayMachine
  relayDrawing: DrawingService
  requireMembership(playerId: string): {
    player: PlayerSecret
    room: RoomSecret
    member: MemberState
  }
  requireRelay(room: RoomSecret): RelayGameSecret
}

/**
 * 接龙对局领域服务。
 */
export class RelayService {
  constructor(private readonly context: RelayServiceContext) {}

  /**
   * 提交本棒作画并锁定。
   */
  submitDrawing(playerId: string, stepId: string): void {
    const { room } = this.context.requireMembership(playerId)
    this.context.relayMachine.submitDrawing(room, playerId, stepId)
  }

  /**
   * 提交本棒猜词文本并锁定。
   */
  submitGuess(playerId: string, stepId: string, text: string): void {
    const { room } = this.context.requireMembership(playerId)
    this.context.relayMachine.submitGuess(room, playerId, stepId, text)
  }

  /**
   * 对当前轮播展示的链投赞同或反对票。
   */
  vote(playerId: string, choice: RelayVoteChoice): void {
    const { room } = this.context.requireMembership(playerId)
    this.context.relayMachine.vote(room, playerId, choice)
  }

  /**
   * 接龙模式下独立自由聊天。
   */
  chat(playerId: string, text: string): void {
    const { room, player } = this.context.requireMembership(playerId)
    this.context.requireRelay(room)
    enforceEventRate(player, 'guess', this.context.clock)
    this.context.relayMachine.chat(room, playerId, text.trim())
  }

  /**
   * 接龙绘图批次添加。
   */
  addStroke(playerId: string, stepId: string, stroke: Stroke): StrokeAck {
    return this.context.relayDrawing.addStroke(playerId, stepId, stroke)
  }

  /**
   * 接龙区域填充。
   */
  addFill(playerId: string, stepId: string, fill: FillCommand): { drawingRevision: number } {
    return this.context.relayDrawing.addFill(playerId, stepId, fill)
  }

  /**
   * 接龙撤销。
   */
  undo(playerId: string, stepId: string): void {
    this.context.relayDrawing.undo(playerId, stepId)
  }

  /**
   * 接龙重做。
   */
  redo(playerId: string, stepId: string): void {
    this.context.relayDrawing.redo(playerId, stepId)
  }

  /**
   * 接龙清空当前链画布。
   */
  clear(playerId: string, stepId: string): void {
    this.context.relayDrawing.clear(playerId, stepId)
  }
}
