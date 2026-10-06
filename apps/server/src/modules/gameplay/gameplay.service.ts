/**
 * 经典对局流程编排领域服务。
 *
 * 遵循《后端架构规范》R3.2 与 R4.3：
 * 1. 负责开局门槛校验、选词、换一组、自定义词与提前结束对局；
 * 2. 协调 RoundMachine 与 RelayMachine 推进对局状态机；
 * 3. 错误全量采用 AppError 抛出。
 */
import {
  ERROR_CODES,
  MIN_SELECTED_VOCABULARY_WORDS,
  RELAY_MIN_PLAYERS,
  normalizeAnswer,
  type RoomSnapshot,
} from '@draw-guess/shared'
import { APP_CONFIG } from '../../core/config.ts'
import { serverStrings } from '@draw-guess/strings'
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors.ts'
import type { GameSecret, MemberState, PlayerSecret, RoomSecret } from '../../models.ts'
import type { Clock } from '../../core/runtime.ts'
import {
  isPhaseExpired,
  activePlayers,
  isOnlinePlayer,
  type OnlineLookup,
} from '../../domain/room/member-facts.ts'
import { buildCustomWord } from '../vocabulary/custom-word.ts'
import type { RoundMachine } from './round-machine.ts'
import type { RelayMachine } from '../../domain/relay/relay-machine.ts'
import type { VocabularyStore } from '../../vocabulary/index.ts'

export interface GameplayServiceContext {
  clock: Clock
  isOnline: OnlineLookup
  requireHostRoom(playerId: string): RoomSecret
  requireMembership(playerId: string): {
    player: PlayerSecret
    room: RoomSecret
    member: MemberState
  }
  requireGame(room: RoomSecret): GameSecret
  getRoomVocabularyStore(room?: RoomSecret): VocabularyStore
  round: RoundMachine
  relay: RelayMachine
  emitRoom(roomId: string): void
  snapshot(room: RoomSecret, playerId: string): RoomSnapshot
  isPlaying(phase: string): boolean
}

/**
 * 经典对局流程服务。
 */
export class GameplayService {
  constructor(private readonly context: GameplayServiceContext) {}

  /**
   * 房主发起开始游戏（经典与接龙分流）。
   */
  startGame(playerId: string, expectedVersion: number): RoomSnapshot {
    const room = this.context.requireHostRoom(playerId)
    if (room.phase !== 'waiting') {
      throw new AppError({
        message: serverStrings.errors.INVALID_PHASE_GAME_STARTED,
        code: ERROR_CODES.INVALID_PHASE,
        status: 409,
      })
    }
    if (room.stateVersion !== expectedVersion) {
      throw new ConflictError(
        serverStrings.errors.VERSION_CONFLICT_START,
        ERROR_CODES.VERSION_CONFLICT,
      )
    }

    const activeMembers = activePlayers(room)
    if (room.gameMode === 'relay') {
      const onlineMembers = activeMembers.filter((member) =>
        isOnlinePlayer(member, this.context.isOnline),
      )
      if (onlineMembers.length < RELAY_MIN_PLAYERS) {
        throw new AppError({
          message: serverStrings.errors.NOT_ENOUGH_PLAYERS_RELAY(RELAY_MIN_PLAYERS),
          code: ERROR_CODES.NOT_ENOUGH_PLAYERS,
          status: 422,
        })
      }
    } else if (activeMembers.length < APP_CONFIG.player.minPlayers) {
      throw new AppError({
        message: serverStrings.errors.NOT_ENOUGH_PLAYERS,
        code: ERROR_CODES.NOT_ENOUGH_PLAYERS,
        status: 422,
      })
    }

    const allOnline = activeMembers.every((member) => isOnlinePlayer(member, this.context.isOnline))
    const guestsReady = activeMembers
      .filter((member) => member.playerId !== room.hostId)
      .every((member) => member.ready)
    if (!allOnline || !guestsReady) {
      throw new AppError({
        message: serverStrings.errors.NOT_ALL_READY,
        code: ERROR_CODES.NOT_ALL_READY,
        status: 409,
      })
    }

    const requiredWords = MIN_SELECTED_VOCABULARY_WORDS
    if (room.selectedWordIds.size < requiredWords) {
      throw new AppError({
        message: serverStrings.errors.VOCABULARY_TOO_SMALL_GAME(requiredWords),
        code: ERROR_CODES.VOCABULARY_TOO_SMALL,
        status: 422,
      })
    }

    if (room.gameMode === 'relay') {
      this.context.relay.beginStarting(room, activeMembers)
    } else {
      this.context.round.beginStarting(room, activeMembers)
    }

    this.context.emitRoom(room.id)
    return this.context.snapshot(room, playerId)
  }

  /**
   * 画家选词。
   */
  chooseWord(playerId: string, roundId: string, wordId: string): void {
    const { room } = this.context.requireMembership(playerId)
    if (room.gameMode === 'relay') {
      this.context.relay.chooseWord(room, playerId, roundId, wordId)
      return
    }

    const game = this.context.requireGame(room)
    if (room.phase !== 'choosing_word' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new ForbiddenError(serverStrings.errors.NOT_DRAWER_CHOOSE, ERROR_CODES.NOT_DRAWER)
    }
    if (isPhaseExpired(game, this.context.clock.now())) {
      throw new AppError({
        message: serverStrings.errors.PHASE_EXPIRED,
        code: ERROR_CODES.PHASE_EXPIRED,
        status: 410,
      })
    }

    const answer = game.candidates.find((word) => word.id === wordId)
    if (!answer) {
      throw new NotFoundError(
        serverStrings.errors.INVALID_WORD_ID_CHOOSE,
        ERROR_CODES.INVALID_WORD_ID,
      )
    }
    this.context.round.beginDrawing(room, answer)
  }

  /**
   * 换一组候选词。
   */
  rerollWordOptions(playerId: string, roundId: string): void {
    const { room } = this.context.requireMembership(playerId)
    if (room.gameMode === 'relay') {
      this.context.relay.rerollWordOptions(room, playerId, roundId)
      return
    }

    const game = this.context.requireGame(room)
    if (room.phase !== 'choosing_word' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new ForbiddenError(serverStrings.errors.NOT_DRAWER_CHOOSE, ERROR_CODES.NOT_DRAWER)
    }
    if (isPhaseExpired(game, this.context.clock.now())) {
      throw new AppError({
        message: serverStrings.errors.PHASE_EXPIRED,
        code: ERROR_CODES.PHASE_EXPIRED,
        status: 410,
      })
    }
    if (!room.settings.allowWordReroll) {
      throw new ForbiddenError(serverStrings.errors.REROLL_DISABLED, ERROR_CODES.REROLL_DISABLED)
    }
    if (game.rerollUsed) {
      throw new AppError({
        message: serverStrings.errors.REROLL_ALREADY_USED,
        code: ERROR_CODES.REROLL_ALREADY_USED,
        status: 409,
      })
    }

    game.candidates = this.context.round.pickCandidates(room, game)
    game.rerollUsed = true
    this.context.emitRoom(room.id)
  }

  /**
   * 画家自定义词。
   */
  chooseCustomWord(playerId: string, roundId: string, rawText: string): void {
    const { room } = this.context.requireMembership(playerId)
    if (room.gameMode === 'relay') {
      this.context.relay.chooseCustomWord(
        room,
        playerId,
        roundId,
        buildCustomWord({ rawText, wordId: `custom:${roundId}` }),
      )
      return
    }

    const game = this.context.requireGame(room)
    if (room.phase !== 'choosing_word' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new ForbiddenError(serverStrings.errors.NOT_DRAWER_CHOOSE, ERROR_CODES.NOT_DRAWER)
    }
    if (isPhaseExpired(game, this.context.clock.now())) {
      throw new AppError({
        message: serverStrings.errors.PHASE_EXPIRED,
        code: ERROR_CODES.PHASE_EXPIRED,
        status: 410,
      })
    }
    if (!room.settings.allowCustomWord) {
      throw new ForbiddenError(serverStrings.errors.CUSTOM_WORD_DISABLED, ERROR_CODES.FORBIDDEN)
    }

    const word = buildCustomWord({ rawText, wordId: `custom:${game.roundId}` })
    if (this.isCustomWordDuplicate(room, game, word.text)) {
      throw new ConflictError(
        serverStrings.errors.CUSTOM_WORD_DUPLICATE,
        ERROR_CODES.CUSTOM_WORD_DUPLICATE,
      )
    }

    game.candidates = [word]
    this.context.round.beginDrawing(room, word)
  }

  private isCustomWordDuplicate(_room: RoomSecret, game: GameSecret, text: string): boolean {
    const normalized = normalizeAnswer(text)
    return game.candidates.some((word) => normalizeAnswer(word.text) === normalized)
  }

  /**
   * 房主提前结束比赛。
   */
  endEarly(playerId: string): void {
    const room = this.context.requireHostRoom(playerId)
    if (room.phase === 'relay_showcase' || room.phase === 'relay_vote') {
      throw new AppError({
        message: serverStrings.errors.INVALID_PHASE_END_EARLY,
        code: ERROR_CODES.INVALID_PHASE,
        status: 409,
      })
    }

    const inProgress = this.context.isPlaying(room.phase) && room.phase !== 'starting'
    if (!inProgress) {
      throw new AppError({
        message: serverStrings.errors.INVALID_PHASE_END_EARLY,
        code: ERROR_CODES.INVALID_PHASE,
        status: 409,
      })
    }

    if (room.gameMode === 'relay') {
      this.context.relay.finishGame(room, serverStrings.notices.endEarlyByHost)
    } else {
      this.context.round.finishGame(room, serverStrings.notices.endEarlyByHost)
    }
  }

  /**
   * 最终结算返回等待房间。
   */
  returnWaiting(playerId: string): void {
    const { room, member } = this.context.requireMembership(playerId)
    if (room.gameMode === 'relay') {
      this.context.relay.requestRematch(room, member)
    } else {
      this.context.round.requestRematch(room, member)
    }
  }
}
