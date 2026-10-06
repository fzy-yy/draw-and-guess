/**
 * 玩家会话与身份领域服务。
 *
 * 遵循《后端架构规范》R3.2 与 R4.3：
 * 1. 业务规则与流程编排集中于此（注册、断线保席、恢复旋转、注销与个人资料变更）；
 * 2. 全量采用 AppError 及其派生子类，抛出标准化稳定错误码；
 * 3. 严格实现 ADR-0011 注销原子性（先原子删除持久化记录，再离房与清内存）。
 */
import {
  ERROR_CODES,
  EVENTS,
  countGraphemes,
  createServerPush,
  isAvatarId,
  normalizeAnswer,
  truncateGraphemes,
  type MemberConnectionChange,
  type Profile,
  type PublicPlayer,
  type ServerPushEnvelope,
  type ServerPushEventName,
  type SessionRegistration,
} from '@draw-guess/shared'
import { APP_CONFIG } from '../../core/config.ts'
import {
  AppError,
  ConflictError,
  InternalError,
  runtimeErrorType,
  type RuntimeLogger,
} from '../../core/errors.ts'
import { serverStrings } from '@draw-guess/strings'
import type { RoomSecret } from '../../models.ts'
import { isInMatchPhase } from '../../domain/room/phase-facts.ts'
import { invalidateMemberCanvasSync } from '../../domain/drawing/canvas-sync.ts'
import type { AppSocket } from '../../socket-types.ts'
import type { PlayerRecord, PlayerSecret } from './session.model.ts'
import type { PlayerRepository } from './session.repository.ts'
import { digestRecoveryToken } from './recovery-token.ts'
import type { PlayerLookupPorts, RoomEventPorts, RuntimePorts } from '../../domain/shared-ports.ts'

/**
 * 会话服务运行期所需依赖与跨模块出口上下文契约。
 */
export interface SessionServiceContext extends RuntimePorts, RoomEventPorts, PlayerLookupPorts {
  /** 向房间广播推送事件但排除指定连接（本人由直接 ACK 或模态框响应） */
  emitRoomEventExcept<E extends ServerPushEventName>(
    roomId: string,
    exceptSocketId: string,
    event: E,
    envelope: ServerPushEnvelope<E>,
  ): void
  /** 结算或提前结束当前回合 */
  finishRound(room: RoomSecret, drawerAbandoned: boolean): void
  /** 离开房间动作 */
  leaveRoom(playerId: string, reason?: string): void
  /** 运行日志记录器 */
  logger: RuntimeLogger
  /** 玩家身份同步落盘 */
  persistPlayer(player: PlayerSecret): void
  /** 内存活跃玩家注册表 */
  players: Map<string, PlayerSecret>
  /** 内存活跃玩家令牌摘要索引 */
  playersByTokenDigest: Map<string, PlayerSecret>
  repositories: {
    players: Pick<
      PlayerRepository,
      | 'consumeRecoveryToken'
      | 'deleteStaleDisconnected'
      | 'markAllDisconnected'
      | 'remove'
      | 'setConnection'
    >
  }
  /** 房间集合 */
  rooms: Map<string, RoomSecret>
  /** 转移断线房主控制权 */
  transferDisconnectedHost(room: RoomSecret, playerId: string): void
  /** 安全异步/定时器执行沙箱 */
  safeRun(label: string, fn: () => void): void
  /** 生成公开玩家资料快照 */
  toPublicPlayer(player: PlayerSecret): PublicPlayer
}

/**
 * 玩家会话与身份领域服务。
 */
export class SessionService {
  constructor(private readonly context: SessionServiceContext) {}

  /**
   * 注册新会话或凭有效恢复令牌接管历史身份。
   */
  register(
    socket: AppSocket,
    input: {
      protocolVersion: string
      profile: Profile
      preferences: { discoverable: boolean; acceptsInvites: boolean }
      recoveryToken?: string
    },
  ): Omit<SessionRegistration, 'room'> {
    // 1. 协议版本强一致性校验
    if (input.protocolVersion !== APP_CONFIG.app.protocolVersion) {
      throw new AppError({
        message: serverStrings.errors.PROTOCOL_MISMATCH,
        code: ERROR_CODES.PROTOCOL_MISMATCH,
        status: 400,
      })
    }

    // 2. 尝试从内存中通过令牌摘要恢复（宽限期内）
    const recoveryTokenDigest = input.recoveryToken
      ? digestRecoveryToken(input.recoveryToken)
      : undefined
    const recovering = recoveryTokenDigest
      ? this.context.playersByTokenDigest.get(recoveryTokenDigest)
      : undefined
    if (
      recovering &&
      (!recovering.disconnectedAt ||
        this.context.clock.now() - recovering.disconnectedAt <= APP_CONFIG.network.reconnectGraceMs)
    ) {
      return this.rotateAndReclaimPlayer(socket, recovering)
    }

    // 3. 内存未命中时，尝试从数据库 CAS 原子消费持久化摘要（重启后首次恢复）
    if (!recovering && recoveryTokenDigest) {
      const nextToken = this.context.random.token(32)
      const record = this.context.repositories.players.consumeRecoveryToken(
        recoveryTokenDigest,
        digestRecoveryToken(nextToken),
        this.context.clock.now() - APP_CONFIG.network.reconnectGraceMs,
      )
      if (record) {
        const restored = this.restorePlayerFromRecord(record)
        if (restored) return this.reclaimPlayer(socket, restored, nextToken)
      }
    }

    // 4. 同一连接上重复注册：复用现有身份
    const boundId = socket.data.playerId
    const bound = boundId ? this.context.players.get(boundId) : undefined
    if (bound && bound.socketId === socket.id) {
      bound.preferences = input.preferences
      this.context.logger.info({ playerId: bound.id }, '玩家在同一连接上重复注册，已复用身份')
      return this.rotateAndReclaimPlayer(socket, bound)
    }

    // 5. 全新玩家注册流程
    const nickname = this.makeUniqueNickname(this.cleanNickname(input.profile.nickname))
    const playerId = this.context.random.uuid()
    const recoveryToken = this.context.random.token(32)
    const player: PlayerSecret = {
      id: playerId,
      tokenDigest: digestRecoveryToken(recoveryToken),
      profile: { nickname, avatarId: input.profile.avatarId },
      preferences: input.preferences,
      socket,
      socketId: socket.id,
      connected: true,
      joinedAt: this.context.clock.now(),
      disconnectGeneration: 0,
      requestCache: new Map(),
      lastInviteAt: new Map(),
      guessEventTimes: [],
      drawEventTimes: [],
      privateJoinAttemptTimes: [],
    }

    this.context.persistPlayer(player)
    this.bindSocketSession(socket, player)
    this.context.players.set(player.id, player)
    this.context.playersByTokenDigest.set(player.tokenDigest, player)
    this.context.logger.info({ playerId: player.id }, '玩家会话已注册')
    this.context.broadcastPresence()

    return {
      player: this.context.toPublicPlayer(player),
      recoveryToken,
      restored: false,
    }
  }

  private restorePlayerFromRecord(record: PlayerRecord): PlayerSecret | undefined {
    if (!isAvatarId(record.avatarId)) return undefined
    const player: PlayerSecret = {
      id: record.id,
      tokenDigest: record.tokenDigest,
      profile: {
        nickname: record.nickname,
        avatarId: record.avatarId,
      },
      preferences: {
        discoverable: record.discoverable,
        acceptsInvites: record.acceptsInvites,
      },
      connected: false,
      joinedAt: record.joinedAt,
      disconnectedAt: record.disconnectedAt,
      disconnectGeneration: 0,
      requestCache: new Map(),
      lastInviteAt: new Map(),
      guessEventTimes: [],
      drawEventTimes: [],
      privateJoinAttemptTimes: [],
    }
    this.context.players.set(player.id, player)
    this.context.playersByTokenDigest.set(player.tokenDigest, player)
    this.context.logger.info({ playerId: player.id }, '玩家身份已从持久化记录恢复')
    return player
  }

  private rotateAndReclaimPlayer(
    socket: AppSocket,
    player: PlayerSecret,
  ): Omit<SessionRegistration, 'room'> {
    const previousTokenDigest = player.tokenDigest
    const nextToken = this.context.random.token(32)
    const nextTokenDigest = digestRecoveryToken(nextToken)
    this.context.playersByTokenDigest.delete(previousTokenDigest)
    player.tokenDigest = nextTokenDigest
    try {
      this.context.persistPlayer(player)
    } catch (error) {
      player.tokenDigest = previousTokenDigest
      this.context.playersByTokenDigest.set(previousTokenDigest, player)
      throw error
    }
    this.context.playersByTokenDigest.set(nextTokenDigest, player)
    return this.reclaimPlayer(socket, player, nextToken)
  }

  /**
   * 服务启动时恢复持久化状态。
   */
  recoverOnStartup(): void {
    this.context.repositories.players.deleteStaleDisconnected(
      this.context.clock.now() - APP_CONFIG.network.reconnectGraceMs,
    )
    this.context.repositories.players.markAllDisconnected(this.context.clock.now())
  }

  private reclaimPlayer(
    socket: AppSocket,
    player: PlayerSecret,
    recoveryToken: string,
  ): Omit<SessionRegistration, 'room'> {
    this.context.scheduler.clear(player.disconnectTimer)
    const previousSocket = player.socket
    player.socket = socket
    player.socketId = socket.id
    player.connected = true
    if (previousSocket && previousSocket.id !== socket.id) previousSocket.disconnect(true)
    delete player.disconnectedAt
    delete player.disconnectTimer
    this.bindSocketSession(socket, player)

    for (const joinedRoomId of socket.rooms) {
      if (joinedRoomId !== socket.id) void socket.leave(joinedRoomId)
    }

    const room = player.roomId ? this.context.rooms.get(player.roomId) : undefined
    if (room) {
      const member = room.members.find((item) => item.playerId === player.id)
      if (member) invalidateMemberCanvasSync(member)
    }
    this.joinSocketRoom(player)
    if (player.roomId) this.context.emitRoom(player.roomId)

    if (room && player.drawingDisconnectRoomId === room.id) {
      const payload: MemberConnectionChange = {
        playerId: player.id,
        nickname: player.profile.nickname,
        connection: 'online',
      }
      this.context.emitRoomEventExcept(
        room.id,
        socket.id,
        EVENTS.roomMemberConnectionChanged,
        createServerPush(EVENTS.roomMemberConnectionChanged, payload),
      )
    }
    delete player.drawingDisconnectRoomId

    this.context.persistPlayer(player)
    this.context.broadcastPresence()
    return {
      player: this.context.toPublicPlayer(player),
      recoveryToken,
      restored: true,
    }
  }

  /**
   * 玩家主动注销会话。
   * 遵循 ADR-0011：先原子删除持久化记录，再离房与清理内存。
   */
  logout(socket: AppSocket): void {
    const playerId = socket.data.playerId
    if (!playerId) return
    const player = this.context.players.get(playerId)
    if (!player || player.socketId !== socket.id) {
      this.detachSocket(socket)
      return
    }

    try {
      this.context.repositories.players.remove(playerId)
    } catch (error) {
      this.context.logger.error(
        { errorType: runtimeErrorType(error), playerId },
        '清理玩家持久化记录失败',
      )
      throw new InternalError(error)
    }

    this.context.scheduler.clear(player.disconnectTimer)
    if (player.roomId) {
      try {
        this.context.leaveRoom(playerId)
      } catch (error) {
        this.context.logger.error(
          { errorType: runtimeErrorType(error), playerId },
          '玩家注销离房失败',
        )
      }
    }

    this.context.players.delete(playerId)
    this.context.playersByTokenDigest.delete(player.tokenDigest)
    this.detachSocket(socket)
  }

  private bindSocketSession(socket: AppSocket, player: PlayerSecret): void {
    socket.data.playerId = player.id
    socket.data.requestCache = player.requestCache
  }

  private detachSocket(socket: AppSocket): void {
    delete socket.data.playerId
    socket.data.requestCache = new Map()
    this.context.broadcastPresence()
  }

  updateProfile(playerId: string, profile: Profile): PublicPlayer {
    const player = this.context.requirePlayer(playerId)
    if (player.roomId) {
      throw new AppError({
        message: serverStrings.errors.PROFILE_LOCKED,
        code: ERROR_CODES.PROFILE_LOCKED,
        status: 409,
      })
    }

    player.profile = {
      nickname: this.makeUniqueNickname(this.cleanNickname(profile.nickname), player.id),
      avatarId: profile.avatarId,
    }
    this.context.persistPlayer(player)
    this.context.broadcastPresence()
    return this.context.toPublicPlayer(player)
  }

  updatePreferences(
    playerId: string,
    preferences: { discoverable: boolean; acceptsInvites: boolean },
  ): void {
    const player = this.context.requirePlayer(playerId)
    player.preferences = preferences
    this.context.persistPlayer(player)
    this.context.broadcastPresence()
  }

  handleDisconnect(socket: AppSocket): void {
    this.context.safeRun('handleDisconnect', () => this.handleDisconnectInternal(socket))
  }

  private handleDisconnectInternal(socket: AppSocket): void {
    const playerId = socket.data.playerId
    if (!playerId) return
    const player = this.context.players.get(playerId)
    if (!player || player.socketId !== socket.id) return
    const room = player.roomId ? this.context.rooms.get(player.roomId) : undefined

    const retainsSeat =
      room !== undefined && (isInMatchPhase(room.phase) || room.phase === 'game_result')
    player.disconnectGeneration += 1
    const generation = player.disconnectGeneration

    player.connected = false
    player.socket = undefined
    player.socketId = undefined
    const disconnectedAt = this.context.clock.now()
    player.disconnectedAt = disconnectedAt
    this.persistDisconnectState(player, disconnectedAt)
    this.context.logger.info(
      { playerId, roomId: player.roomId, retainedSeat: retainsSeat },
      retainsSeat ? '玩家对局阶段断线并保留席位' : '玩家断线并进入身份恢复宽限',
    )

    if (room && retainsSeat) {
      this.retainMatchSeat(player, room, generation)
    } else {
      delete player.drawingDisconnectRoomId
      if (room) {
        this.context.leaveRoom(
          playerId,
          serverStrings.notices.playerDisconnectedLeave(player.profile.nickname),
        )
      }
    }

    this.scheduleIdentityGrace(playerId)
    this.context.broadcastPresence()
  }

  private persistDisconnectState(player: PlayerSecret, disconnectedAt: number): void {
    try {
      this.context.repositories.players.setConnection(player.id, false, disconnectedAt)
    } catch (err) {
      this.context.logger.error(
        { errorType: runtimeErrorType(err), playerId: player.id },
        '断线状态持久化异常',
      )
    }
  }

  private retainMatchSeat(player: PlayerSecret, room: RoomSecret, generation: number): void {
    const playerId = player.id
    player.drawingDisconnectRoomId = room.id
    const member = room.members.find((item) => item.playerId === playerId)
    if (member) invalidateMemberCanvasSync(member)
    const payload: MemberConnectionChange = {
      playerId,
      nickname: player.profile.nickname,
      connection: 'reconnecting',
    }
    this.context.emitRoomEvent(
      room.id,
      EVENTS.roomMemberConnectionChanged,
      createServerPush(EVENTS.roomMemberConnectionChanged, payload),
    )

    if (room.hostId === playerId) {
      this.context.scheduler.set(APP_CONFIG.network.hostReconnectGraceMs, () =>
        this.context.safeRun('hostReconnectTimeout', () => {
          if (
            !this.isSameDisconnectEpisode(player, generation, room.id) ||
            room.hostId !== playerId ||
            room.members.length <= 1
          ) {
            return
          }
          this.context.transferDisconnectedHost(room, playerId)
        }),
      )
    }
    this.context.emitRoom(room.id)
  }

  private scheduleIdentityGrace(playerId: string): void {
    const player = this.context.players.get(playerId)
    if (!player) return
    player.disconnectTimer = this.context.scheduler.set(APP_CONFIG.network.reconnectGraceMs, () =>
      this.context.safeRun('expireDisconnectedPlayer', () =>
        this.expireDisconnectedPlayer(playerId),
      ),
    )
  }

  private isSameDisconnectEpisode(
    player: PlayerSecret,
    generation: number,
    roomId: string,
  ): boolean {
    return (
      !player.connected && player.disconnectGeneration === generation && player.roomId === roomId
    )
  }

  private expireDisconnectedPlayer(playerId: string): void {
    const player = this.context.players.get(playerId)
    if (!player || player.connected) return
    if (player.roomId) {
      this.context.leaveRoom(playerId, serverStrings.notices.playerReconnectedTimeout)
    }
    this.context.players.delete(player.id)
    this.context.playersByTokenDigest.delete(player.tokenDigest)
    this.context.repositories.players.remove(player.id)
    this.context.broadcastPresence()
  }

  private cleanNickname(value: string): string {
    const clean = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
    const length = countGraphemes(clean)
    if (
      length < APP_CONFIG.player.nicknameMinLength ||
      length > APP_CONFIG.player.nicknameMaxLength
    ) {
      throw new AppError({
        message: serverStrings.errors.INVALID_NICKNAME(
          APP_CONFIG.player.nicknameMinLength,
          APP_CONFIG.player.nicknameMaxLength,
        ),
        code: ERROR_CODES.INVALID_NICKNAME,
        status: 422,
      })
    }
    return truncateGraphemes(clean, APP_CONFIG.player.nicknameMaxLength)
  }

  private makeUniqueNickname(value: string, exceptId?: string): string {
    const occupied = new Set(
      [...this.context.players.values()]
        .filter((player) => player.id !== exceptId)
        .map((player) => normalizeAnswer(player.profile.nickname)),
    )
    if (!occupied.has(normalizeAnswer(value))) return value

    for (let suffix = 2; suffix <= 99; suffix += 1) {
      const base = truncateGraphemes(
        value,
        APP_CONFIG.player.nicknameMaxLength - String(suffix).length,
      )
      const candidate = `${base}${suffix}`
      if (!occupied.has(normalizeAnswer(candidate))) return candidate
    }
    throw new ConflictError(serverStrings.errors.DUPLICATE_NICKNAME, ERROR_CODES.DUPLICATE_NICKNAME)
  }

  private joinSocketRoom(player: PlayerSecret): void {
    if (player.roomId) void player.socket?.join(player.roomId)
  }
}
