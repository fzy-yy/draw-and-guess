/**
 * 经典猜词判定与聊天互动领域服务。
 *
 * 遵循《后端架构规范》R3.2 与 R4.3：
 * 1. 负责猜词答案匹配（标准化对比、别称识别、画家拦截、差一字私密提示）；
 * 2. 预设安全短语与画板微表情（Canvas Ping）限频校验与广播；
 * 3. 错误全量采用 AppError 抛出。
 *
 * 边界：本服务只服务**经典模式**的作答与画布互动；接龙房专属的自由聊天（`chat:say`）归接龙模块
 *（`RelayService.chat` → `RelayMachine`），消息产出的唯一实现在那里，本模块不复制第二份。
 */
import {
  ERROR_CODES,
  isNearMissAnswer,
  normalizeAnswer,
  type CanvasPingBroadcast,
  type CanvasPingType,
} from '@draw-guess/shared'
import { APP_CONFIG } from '../../core/config.ts'
import { serverStrings } from '@draw-guess/strings'
import { AppError, ForbiddenError, RateLimitError } from '../../core/errors.ts'
import type { GameSecret, MemberState, PlayerSecret, RoomSecret } from '../../models.ts'
import { enforceEventRate, slidingWindowAllow } from '../../rate-limit.ts'
import type { Clock } from '../../core/runtime.ts'
import { isPhaseExpired } from '../../domain/room/member-facts.ts'
import type { RoundMachine } from '../../round-machine.ts'

/**
 * 聊天服务上下文依赖契约。
 */
export interface ChatServiceContext {
  clock: Clock
  requireMembership(playerId: string): {
    player: PlayerSecret
    room: RoomSecret
    member: MemberState
  }
  requirePlayer(playerId: string): PlayerSecret
  requireGame(room: RoomSecret): GameSecret
  round: RoundMachine
  emitRoom(roomId: string): void
  emitCanvasPing(roomId: string, payload: CanvasPingBroadcast): void
}

/**
 * 猜词与聊天领域服务。
 */
export class ChatService {
  constructor(private readonly context: ChatServiceContext) {}

  /**
   * 提交猜词尝试。
   */
  submitGuess(playerId: string, roundId: string, rawText: string): { correct: boolean } {
    const { room, member } = this.context.requireMembership(playerId)
    const game = this.context.requireGame(room)

    if (room.phase !== 'drawing' || game.roundId !== roundId || !game.answer) {
      throw new AppError({
        message: serverStrings.errors.INVALID_PHASE_GUESS,
        code: ERROR_CODES.INVALID_PHASE,
        status: 409,
      })
    }
    if (isPhaseExpired(game, this.context.clock.now())) {
      throw new AppError({
        message: serverStrings.errors.PHASE_EXPIRED,
        code: ERROR_CODES.PHASE_EXPIRED,
        status: 410,
      })
    }

    const text = rawText.trim()
    enforceEventRate(this.context.requirePlayer(playerId), 'guess', this.context.clock)
    if (!text || Array.from(text).length > APP_CONFIG.player.chatMaxLength) {
      throw new AppError({
        message: serverStrings.errors.INVALID_MESSAGE_EMPTY,
        code: ERROR_CODES.INVALID_MESSAGE,
        status: 422,
      })
    }

    const normalized = normalizeAnswer(text)
    const answer = normalizeAnswer(game.answer.text)
    const acceptedAnswers = [answer, ...game.answer.aliases.map((alias) => normalizeAnswer(alias))]
    const isAnswer = acceptedAnswers.includes(normalized)

    // 画家发送消息分支：命中答案则拦截，其余作为普通消息广播
    if (game.drawerId === playerId) {
      if (isAnswer) {
        throw new AppError({
          message: serverStrings.errors.DRAWER_CANNOT_GUESS,
          code: ERROR_CODES.DRAWER_CANNOT_GUESS,
          status: 403,
        })
      }
      this.context.round.addMessage(room, { type: 'guess', text, playerId })
      this.context.emitRoom(room.id)
      return { correct: false }
    }

    if (member.guessedAt) {
      throw new AppError({
        message: serverStrings.errors.ALREADY_GUESSED,
        code: ERROR_CODES.ALREADY_GUESSED,
        status: 409,
      })
    }

    if (isAnswer) {
      this.context.round.markCorrect(room, member)
      return { correct: true }
    }

    // 未命中：进入公屏聊天流
    this.context.round.addMessage(room, { type: 'guess', text, playerId })

    // 差一字私密提示
    const targets = [game.answer.text, ...game.answer.aliases]
    if (
      room.settings.allowNearMissHint &&
      targets.some((candidate) => isNearMissAnswer(text, candidate))
    ) {
      this.context.round.addMessage(room, {
        type: 'near_miss',
        text: serverStrings.notices.nearMissHint,
        recipientId: playerId,
      })
    }

    this.context.emitRoom(room.id)
    return { correct: false }
  }

  /**
   * 发送预设快捷安全短语。
   */
  sendPreset(playerId: string, roundId: string, preset: string): void {
    const { room } = this.context.requireMembership(playerId)
    const game = this.context.requireGame(room)

    if (room.phase !== 'drawing' || game.roundId !== roundId) {
      throw new AppError({
        message: serverStrings.errors.INVALID_PHASE_PRESET,
        code: ERROR_CODES.INVALID_PHASE,
        status: 409,
      })
    }

    const allowedPresets: readonly string[] = [
      ...APP_CONFIG.presets.safeChat,
      ...APP_CONFIG.presets.chatReactions,
    ]
    if (!allowedPresets.includes(preset)) {
      throw new AppError({
        message: serverStrings.errors.INVALID_MESSAGE_PRESET,
        code: ERROR_CODES.INVALID_MESSAGE,
        status: 422,
      })
    }

    this.context.round.addMessage(room, { type: 'preset', text: preset, playerId })
    this.context.emitRoom(room.id)
  }

  /**
   * 发送画板微表情（👍 / ❓ / 🔥）。
   */
  sendCanvasPing(playerId: string, x: number, y: number, type: CanvasPingType): void {
    const { room, player } = this.context.requireMembership(playerId)

    if (room.gameMode === 'relay') {
      throw new ForbiddenError(
        serverStrings.errors.FORBIDDEN_RELAY_CANVAS_PING,
        ERROR_CODES.FORBIDDEN,
      )
    }
    if (!room.settings.allowCanvasReactions) {
      throw new ForbiddenError(serverStrings.errors.FORBIDDEN, ERROR_CODES.FORBIDDEN)
    }

    const now = this.context.clock.now()
    const decision = slidingWindowAllow(player.canvasReactionTimes ?? [], now, 1_500, 1)
    player.canvasReactionTimes = decision.times
    if (!decision.allowed) {
      throw new RateLimitError(serverStrings.errors.RATE_LIMITED)
    }

    const payload: CanvasPingBroadcast = {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      type,
      senderNickname: player.profile.nickname,
    }
    this.context.emitCanvasPing(room.id, payload)
  }
}
