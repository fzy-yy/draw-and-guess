/**
 * 房间生命周期与成员管理领域服务。
 *
 * 遵循《后端架构规范》R3.2 与 R4.3：
 * 1. 负责房间创建、公开/私密加入、离房、退局、准备、规则更新、房主转移与踢人；
 * 2. 状态机流转与乐观版本控制；
 * 3. 错误全量采用 GameError / ConflictError 等 AppError 子类抛出，保持对外稳定错误码。
 */
import {
  DEFAULT_GAME_MODE,
  ERROR_CODES,
  EVENTS,
  PLAYER_PROTOCOL_LIMITS,
  ROOM_CLOSE_CODE,
  createServerPush,
  type GameMode,
  type MemberConnectionChange,
  type RoomCloseCode,
  type RoomPhase,
  type RoomSettings,
  type RoomSnapshot,
  type RoomVisibility,
  type ServerPushEnvelope,
  type ServerPushEventName,
} from '@draw-guess/shared'
import { APP_CONFIG } from '../../core/config.ts'
import { serverStrings } from '@draw-guess/strings'
import {
  ConflictError,
  ForbiddenError,
  GameError,
  NotFoundError,
  RateLimitError,
  type RuntimeLogger,
} from '../../core/errors.ts'
import type { GameSecret, MemberState, PlayerSecret, RoomSecret } from '../../models.ts'
import { slidingWindowAllow } from '../../rate-limit.ts'
import type { PlayerLookupPorts, RoomEventPorts, RuntimePorts } from '../../domain/shared-ports.ts'
import type { VocabularyRegistry, VocabularyStore } from '../../vocabulary/index.ts'
import {
  createEmptyMemberStats,
  createOnlineLookup,
  isActivePlayer,
  isOnlinePlayer,
  nicknameOf,
  occupiesSeat,
  type OnlineLookup,
} from '../../domain/room/member-facts.ts'
import { phaseEquivalent, reseatMembers } from '../../domain/room/room-facts.ts'

/**
 * 模式 → 生效的规则键名。
 */
export const MODE_SETTINGS_KEYS = {
  classic: [
    'roundsPerPlayer',
    'drawSeconds',
    'chooseSeconds',
    'showWordLength',
    'progressiveHints',
    'allowNearMissHint',
    'allowCanvasReactions',
    'allowRoundReplay',
    'optionCount',
    'allowWordReroll',
    'allowCustomWord',
    'allowPlayerInvite',
  ],
  relay: [
    'relayChooseSeconds',
    'relayDrawSeconds',
    'relayGuessSeconds',
    'optionCount',
    'allowWordReroll',
    'allowCustomWord',
    'allowPlayerInvite',
  ],
} as const satisfies Record<GameMode, readonly (keyof RoomSettings)[]>

/**
 * 房间服务运行期所需依赖与跨模块出口上下文契约。
 */
export interface RoomServiceContext extends RuntimePorts, RoomEventPorts, PlayerLookupPorts {
  abandonChoosing(room: RoomSecret, notice: string): void
  addSystemNotice(room: RoomSecret, text: string): void
  clearHintTimers(game: GameSecret): void
  invalidateReady(room: RoomSecret, notice: string): void
  emitToPlayer<E extends ServerPushEventName>(
    playerId: string,
    event: E,
    envelope: ServerPushEnvelope<E>,
  ): void
  evaluateRematch(room: RoomSecret): void
  finishRound(room: RoomSecret, drawerAbandoned: boolean): void
  getRoomVocabularyStore(room?: RoomSecret): VocabularyStore
  isPlaying(phase: RoomPhase): boolean
  logger: RuntimeLogger
  players: Map<string, PlayerSecret>
  rooms: Map<string, RoomSecret>
  roomsByPrivateCode: Map<string, string>
  setWaiting(room: RoomSecret, notice: string, resetReady?: boolean): void
  snapshot(room: RoomSecret, playerId: string): RoomSnapshot
  transition(room: RoomSecret, next: RoomPhase): void
  vocabulary: VocabularyRegistry
}

/**
 * 房间生命周期与成员服务。
 */
export class RoomService {
  private readonly isOnline: OnlineLookup

  constructor(private readonly context: RoomServiceContext) {
    this.isOnline = createOnlineLookup(this.context.players)
  }

  /**
   * 转移断线房主控制权至在线可玩成员。
   */
  transferDisconnectedHost(room: RoomSecret, playerId: string): void {
    const candidate = room.members.find(
      (member) => member.playerId !== playerId && isOnlinePlayer(member, this.isOnline),
    )
    if (!candidate) return
    this.applyHostChange(
      room,
      candidate.playerId,
      serverStrings.notices.hostMigratedTimeout(
        nicknameOf(this.context.players, candidate.playerId, serverStrings.notices.hostFallback),
      ),
      { bumpVersion: true, emitRoom: true, broadcastPresence: false },
    )
  }

  /**
   * 创建新房间。
   */
  createRoom(
    playerId: string,
    input: {
      name: string
      visibility: RoomVisibility
      gameMode?: GameMode
      settings: RoomSettings
    },
  ): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId)
    const privateJoinCode =
      input.visibility === 'private' ? this.generatePrivateJoinCode() : undefined

    const defaultPackageId = this.context.vocabulary.defaultPackageId
    const defaultStore = this.context.getRoomVocabularyStore()
    const room: RoomSecret = {
      id: this.context.random.uuid(),
      name: input.name.trim(),
      hostId: player.id,
      visibility: input.visibility,
      gameMode: input.gameMode ?? DEFAULT_GAME_MODE,
      ...(privateJoinCode ? { privateJoinCode } : {}),
      phase: 'waiting',
      stateVersion: 1,
      settings: input.settings,
      members: [],
      vocabularyPackageId: defaultPackageId,
      selectedWordIds: new Set(defaultStore.items.map((word) => word.id)),
    }

    room.members.push(this.createMember(player, room))
    player.roomId = room.id
    this.context.rooms.set(room.id, room)
    if (privateJoinCode) this.context.roomsByPrivateCode.set(privateJoinCode, room.id)
    this.context.logger.info(
      { roomId: room.id, playerId, visibility: room.visibility },
      '房间已创建',
    )
    void player.socket?.join(room.id)
    this.context.emitRoom(room.id)
    this.context.broadcastPresence()
    return this.context.snapshot(room, player.id)
  }

  /**
   * 加入公开房间。
   */
  joinRoom(playerId: string, roomId: string): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId)
    const room = this.context.rooms.get(roomId)
    if (!room || room.visibility !== 'public') {
      throw new NotFoundError(serverStrings.errors.ROOM_NOT_FOUND, ERROR_CODES.ROOM_NOT_FOUND)
    }
    return this.joinResolvedRoom(player, room, 'public')
  }

  /**
   * 凭短码加入私密房间。
   */
  joinPrivateRoom(playerId: string, code: string): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId)
    const attempt = slidingWindowAllow(
      player.privateJoinAttemptTimes,
      this.context.clock.now(),
      APP_CONFIG.room.privateJoinWindowMs,
      APP_CONFIG.room.privateJoinMaxAttempts,
    )
    player.privateJoinAttemptTimes = attempt.times
    if (!attempt.allowed) {
      throw new RateLimitError(serverStrings.errors.RATE_LIMITED_PRIVATE_JOIN)
    }

    const roomId = this.context.roomsByPrivateCode.get(code)
    const room = roomId ? this.context.rooms.get(roomId) : undefined
    if (!room || room.visibility !== 'private') {
      throw new NotFoundError(
        serverStrings.errors.PRIVATE_ROOM_NOT_FOUND,
        ERROR_CODES.PRIVATE_ROOM_NOT_FOUND,
      )
    }
    player.privateJoinAttemptTimes = []
    return this.joinResolvedRoom(player, room, 'private-code')
  }

  /**
   * 统一房间落位门禁与进入执行。
   */
  public joinResolvedRoom(
    player: PlayerSecret,
    room: RoomSecret,
    source: 'public' | 'private-code' | 'invite',
  ): RoomSnapshot {
    if (room.members.some((member) => member.playerId === player.id && member.leftGame)) {
      throw new ConflictError(serverStrings.errors.GAME_ALREADY_LEFT, ERROR_CODES.GAME_ALREADY_LEFT)
    }

    if (room.phase !== 'waiting') {
      throw new ConflictError(
        serverStrings.errors.GAME_IN_PROGRESS_FORBID,
        ERROR_CODES.GAME_IN_PROGRESS,
      )
    }

    const occupyingMembers = room.members.filter(occupiesSeat)
    if (occupyingMembers.length >= PLAYER_PROTOCOL_LIMITS.maxPlayers) {
      throw new ConflictError(serverStrings.errors.ROOM_FULL, ERROR_CODES.ROOM_FULL)
    }

    const member = this.createMember(player, room)
    room.members.push(member)
    room.stateVersion += 1
    this.context.logger.info({ roomId: room.id, playerId: player.id, source }, '玩家已加入房间')
    player.roomId = room.id
    void player.socket?.join(room.id)
    this.context.addSystemNotice(room, serverStrings.notices.playerJoined(player.profile.nickname))
    this.context.emitRoom(room.id)
    this.context.broadcastPresence()
    return this.context.snapshot(room, player.id)
  }

  /**
   * 切换准备状态（仅等待阶段），并递增版本号通知全员。
   */
  setReady(playerId: string, ready: boolean): RoomSnapshot {
    const { room, member } = this.requireMembership(playerId)
    if (room.phase !== 'waiting') {
      throw new GameError(
        ERROR_CODES.INVALID_PHASE,
        serverStrings.errors.INVALID_PHASE_READY,
        undefined,
        409,
      )
    }
    if (room.hostId === playerId || member.ready === ready) {
      return this.context.snapshot(room, playerId)
    }
    member.ready = ready
    room.stateVersion += 1
    this.context.emitRoom(room.id)
    return this.context.snapshot(room, playerId)
  }

  /**
   * 房主更新房间设置规则。
   */
  updateSettings(
    playerId: string,
    patch: Partial<RoomSettings>,
    expectedVersion: number,
  ): RoomSnapshot {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting') {
      throw new GameError(
        ERROR_CODES.SETTINGS_LOCKED,
        serverStrings.errors.SETTINGS_LOCKED_UPDATE,
        undefined,
        409,
      )
    }
    if (room.stateVersion !== expectedVersion) {
      throw new ConflictError(
        serverStrings.errors.VERSION_CONFLICT_SETTINGS,
        ERROR_CODES.VERSION_CONFLICT,
      )
    }
    const effectiveKeys: readonly string[] = MODE_SETTINGS_KEYS[room.gameMode]
    if (Object.keys(patch).some((key) => !effectiveKeys.includes(key))) {
      throw new GameError(
        ERROR_CODES.INVALID_SETTINGS,
        serverStrings.errors.INVALID_SETTINGS,
        undefined,
        422,
      )
    }
    room.settings = { ...room.settings, ...patch }
    this.context.invalidateReady(room, serverStrings.notices.rulesUpdated)
    this.context.emitRoom(room.id)
    this.context.broadcastPresence()
    return this.context.snapshot(room, playerId)
  }

  /**
   * 离开当前房间。
   */
  leaveRoom(playerId: string, reason: string = serverStrings.notices.leaveReasonDefault): void {
    const player = this.context.requirePlayer(playerId)
    if (!player.roomId) {
      return
    }
    const room = this.context.rooms.get(player.roomId)
    if (!room) {
      delete player.roomId
      return
    }

    void player.socket?.leave(room.id)
    room.members = room.members.filter((member) => member.playerId !== playerId)
    if (room.phase === 'waiting') reseatMembers(room)
    this.context.logger.info({ roomId: room.id, playerId, reason }, '玩家已离开房间')
    delete player.roomId
    room.stateVersion += 1

    if (room.members.length === 0) {
      this.closeRoom(room, serverStrings.notices.closeRoomEmpty, ROOM_CLOSE_CODE.roomEmpty)
      return
    }

    if (this.reclaimHostOrClose(room, playerId)) return

    if (room.phase === 'starting') {
      this.context.setWaiting(room, serverStrings.notices.countdownCanceled, false)
    } else if (room.phase === 'waiting') {
      this.context.addSystemNotice(room, serverStrings.notices.playerLeft(player.profile.nickname))
    } else {
      this.settleDrawerDeparture(room, playerId, player.profile.nickname)
    }

    this.finalizeDepartureTail(room)
  }

  /**
   * 对局进行中主动退出。
   */
  leaveGame(playerId: string): void {
    const { room, member, player } = this.requireMembership(playerId)
    if (room.phase === 'waiting') {
      throw new GameError(
        ERROR_CODES.INVALID_PHASE,
        serverStrings.errors.INVALID_PHASE_LEAVE_GAME,
        undefined,
        409,
      )
    }
    if (member.leftGame) return

    member.leftGame = true
    member.leftProfile = { ...player.profile }
    member.ready = false
    void player.socket?.leave(room.id)
    delete player.roomId
    room.stateVersion += 1
    this.context.logger.info({ roomId: room.id, playerId }, '玩家主动退出当前对局并保留成绩卡')

    const payload: MemberConnectionChange = {
      playerId,
      nickname: player.profile.nickname,
      connection: 'left',
    }
    this.context.emitRoomEvent(
      room.id,
      EVENTS.roomMemberConnectionChanged,
      createServerPush(EVENTS.roomMemberConnectionChanged, payload),
    )

    if (this.reclaimHostOrClose(room, playerId)) return

    if (room.phase === 'starting') {
      room.members = room.members.filter((candidate) => !candidate.leftGame)
      this.context.setWaiting(room, serverStrings.notices.countdownCanceled, false)
      this.context.broadcastPresence()
      return
    }

    this.settleDrawerDeparture(room, playerId, player.profile.nickname)
    this.finalizeDepartureTail(room)
  }

  private reclaimHostOrClose(room: RoomSecret, playerId: string): boolean {
    if (room.hostId !== playerId || this.transferHostInternal(room)) return false
    this.closeRoom(
      room,
      serverStrings.notices.closeRoomNoPlayableHost,
      ROOM_CLOSE_CODE.noPlayableHost,
    )
    return true
  }

  private settleDrawerDeparture(room: RoomSecret, playerId: string, nickname: string): void {
    if (room.game?.drawerId !== playerId) return
    if (phaseEquivalent(room, 'choosing_word')) {
      this.context.abandonChoosing(room, serverStrings.notices.drawerLeftChoosing(nickname))
    } else if (phaseEquivalent(room, 'drawing')) {
      this.context.finishRound(room, true)
    }
  }

  private finalizeDepartureTail(room: RoomSecret): void {
    if (room.phase === 'game_result') this.context.evaluateRematch(room)
    this.context.emitRoom(room.id)
    this.context.broadcastPresence()
  }

  /**
   * 房主踢出指定成员。
   */
  kick(playerId: string, targetId: string): void {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting') {
      throw new GameError(
        ERROR_CODES.INVALID_PHASE,
        serverStrings.errors.INVALID_PHASE_KICK,
        undefined,
        409,
      )
    }
    if (targetId === playerId) {
      throw new GameError(
        ERROR_CODES.INVALID_TARGET,
        serverStrings.errors.INVALID_TARGET_SELF,
        undefined,
        422,
      )
    }
    if (!room.members.some((member) => member.playerId === targetId)) {
      throw new NotFoundError(serverStrings.errors.NOT_IN_ROOM_KICK, ERROR_CODES.NOT_IN_ROOM)
    }

    this.context.emitToPlayer(
      targetId,
      EVENTS.roomClosed,
      createServerPush(EVENTS.roomClosed, {
        reason: serverStrings.notices.kickedReason,
        code: ROOM_CLOSE_CODE.kicked,
      }),
    )
    this.leaveRoom(targetId, serverStrings.notices.kickedLog)
  }

  /**
   * 房主移交控制权。
   */
  transferHost(playerId: string, targetId: string): void {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting') {
      throw new GameError(
        ERROR_CODES.INVALID_PHASE,
        serverStrings.errors.INVALID_PHASE_TRANSFER_HOST,
        undefined,
        409,
      )
    }
    const targetMember = room.members.find((member) => member.playerId === targetId)
    if (!targetMember) {
      throw new NotFoundError(serverStrings.errors.NOT_IN_ROOM_TRANSFER, ERROR_CODES.NOT_IN_ROOM)
    }

    this.applyHostChange(
      room,
      targetId,
      serverStrings.notices.hostTransferred(
        nicknameOf(this.context.players, targetId, serverStrings.notices.hostFallback),
      ),
      { bumpVersion: true, emitRoom: true, broadcastPresence: true },
    )
  }

  private closeRoom(room: RoomSecret, reason: string, code: RoomCloseCode): void {
    this.context.transition(room, 'closed')
    if (room.game) this.context.clearHintTimers(room.game)
    this.context.scheduler.clear(room.game?.timer)
    this.context.scheduler.clear(room.game?.rematchTimer)
    this.context.emitRoomEvent(
      room.id,
      EVENTS.roomClosed,
      createServerPush(EVENTS.roomClosed, { reason, code }),
    )

    for (const member of room.members) {
      const player = this.context.players.get(member.playerId)
      if (!player) continue
      void player.socket?.leave(room.id)
      if (player.roomId === room.id) {
        delete player.roomId
      }
    }
    if (room.privateJoinCode) this.context.roomsByPrivateCode.delete(room.privateJoinCode)
    this.context.rooms.delete(room.id)
    this.context.broadcastPresence()
  }

  private transferHostInternal(room: RoomSecret): boolean {
    const candidate =
      room.members.find((member) => isOnlinePlayer(member, this.isOnline)) ??
      room.members.find(isActivePlayer)
    if (!candidate) return false
    this.applyHostChange(
      room,
      candidate.playerId,
      serverStrings.notices.hostMigrated(
        nicknameOf(this.context.players, candidate.playerId, serverStrings.notices.hostFallback),
      ),
      { bumpVersion: false, emitRoom: false, broadcastPresence: false },
    )
    return true
  }

  private applyHostChange(
    room: RoomSecret,
    nextHostId: string,
    notice: string,
    options: { bumpVersion: boolean; emitRoom: boolean; broadcastPresence: boolean },
  ): void {
    room.hostId = nextHostId
    this.rotatePrivateJoinCode(room)
    if (options.bumpVersion) room.stateVersion += 1
    this.context.addSystemNotice(room, notice)
    if (options.emitRoom) this.context.emitRoom(room.id)
    if (options.broadcastPresence) this.context.broadcastPresence()
  }

  private generatePrivateJoinCode(): string {
    const alphabet = APP_CONFIG.room.privateCodeAlphabet
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const code = Array.from({ length: APP_CONFIG.room.privateCodeLength }, () =>
        alphabet.charAt(this.context.random.integer(alphabet.length)),
      ).join('')
      if (!this.context.roomsByPrivateCode.has(code)) return code
    }
    throw new GameError(
      ERROR_CODES.PRIVATE_CODE_EXHAUSTED,
      serverStrings.errors.PRIVATE_CODE_EXHAUSTED,
      undefined,
      503,
    )
  }

  private rotatePrivateJoinCode(room: RoomSecret): void {
    if (room.visibility !== 'private') return
    if (room.privateJoinCode) this.context.roomsByPrivateCode.delete(room.privateJoinCode)
    room.privateJoinCode = this.generatePrivateJoinCode()
    this.context.roomsByPrivateCode.set(room.privateJoinCode, room.id)
  }

  private createMember(player: PlayerSecret, room: RoomSecret): MemberState {
    const occupied = new Set(room.members.filter(occupiesSeat).map((member) => member.seatIndex))
    const seatIndex = APP_CONFIG.room.seatColors.findIndex((_color, index) => !occupied.has(index))
    if (seatIndex < 0) {
      throw new ConflictError(serverStrings.errors.ROOM_FULL, ERROR_CODES.ROOM_FULL)
    }
    return {
      playerId: player.id,
      seatIndex,
      ready: false,
      score: 0,
      joinedAt: this.context.clock.now(),
      stats: createEmptyMemberStats(),
    }
  }

  public requireAvailablePlayer(playerId: string): PlayerSecret {
    const player = this.context.requirePlayer(playerId)
    if (player.roomId) {
      throw new ConflictError(serverStrings.errors.ALREADY_IN_ROOM, ERROR_CODES.ALREADY_IN_ROOM)
    }
    return player
  }

  public requireMembership(playerId: string): {
    player: PlayerSecret
    room: RoomSecret
    member: MemberState
  } {
    const player = this.context.requirePlayer(playerId)
    const room = player.roomId ? this.context.rooms.get(player.roomId) : undefined
    const member = room?.members.find((candidate) => candidate.playerId === playerId)
    if (!room || !member) {
      throw new NotFoundError(serverStrings.errors.NOT_IN_ROOM, ERROR_CODES.NOT_IN_ROOM)
    }
    return { player, room, member }
  }

  public requireHostRoom(playerId: string): RoomSecret {
    const { room } = this.requireMembership(playerId)
    if (room.hostId !== playerId) {
      throw new ForbiddenError(serverStrings.errors.FORBIDDEN, ERROR_CODES.FORBIDDEN)
    }
    return room
  }
}
