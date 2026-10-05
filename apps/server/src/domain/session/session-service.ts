import {
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
import { APP_CONFIG } from '../../config/index.ts'
import { invalidateMemberCanvasSync } from '../drawing/canvas-sync.ts'
import { serverStrings } from '@draw-guess/strings'
import { GameError, runtimeErrorType, type RuntimeLogger } from '../../errors.ts'
import type { PlayerSecret, RoomSecret } from '../../models.ts'
import { isInMatchPhase } from '../room/phase-facts.ts'
import type { PlayerRecord, PlayerRepository } from '../../repositories/index.ts'
import type { AppSocket } from '../../socket-types.ts'
import { digestRecoveryToken } from '../../security/recovery-token.ts'
import type { PlayerLookupPorts, RoomEventPorts, RuntimePorts } from '../shared-ports.ts'

/** 仅暴露本用例需要的数据与副作用端口；共享出口见 domain/shared-ports.ts，由应用层连接跨用例动作。 */
export interface SessionServiceContext extends RuntimePorts, RoomEventPorts, PlayerLookupPorts {
  /** 向房间广播推送事件但排除指定连接：本人由连接恢复模态框反馈，无需重复通知。 */
  emitRoomEventExcept<E extends ServerPushEventName>(
    roomId: string,
    exceptSocketId: string,
    event: E,
    envelope: ServerPushEnvelope<E>,
  ): void
  finishRound(room: RoomSecret, drawerAbandoned: boolean): void
  leaveRoom(playerId: string, reason?: string): void
  logger: RuntimeLogger
  persistPlayer(player: PlayerSecret): void
  players: Map<string, PlayerSecret>
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
  rooms: Map<string, RoomSecret>
  transferDisconnectedHost(room: RoomSecret, playerId: string): void
  safeRun(label: string, fn: () => void): void
  toPublicPlayer(player: PlayerSecret): PublicPlayer
}

export class SessionService {
  constructor(private readonly context: SessionServiceContext) {}
  register(
    socket: AppSocket,
    input: {
      protocolVersion: string
      profile: Profile
      preferences: { discoverable: boolean; acceptsInvites: boolean }
      recoveryToken?: string
    },
  ): Omit<SessionRegistration, 'room'> {
    // 协议版本不匹配时直接拒绝，避免新旧客户端互相干扰
    if (input.protocolVersion !== APP_CONFIG.app.protocolVersion) {
      throw new GameError('PROTOCOL_MISMATCH', serverStrings.errors.PROTOCOL_MISMATCH)
    }
    // 头像编号的白名单裁决在协议层（AvatarIdSchema 枚举）完成，类型 AvatarId 已收窄；
    // 服务层不再重复 includes 判断（跨持久化边界的恢复路径另有复核，见 restorePlayerFromRecord）。

    // 携带恢复令牌且仍处于宽限期内的玩家：复用原身份与座位（如仍在房间）
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
    // 内存索引未命中时原子消费持久化摘要：服务重启后摘要索引为空，
    // 只有一个并发请求能把旧摘要 CAS 为新摘要，成功者得到新的明文令牌。
    // （房间席位不恢复：进行中局在重启时已被作废，恢复后回到大厅。）
    // 守卫直接判 recoveryTokenDigest：它与 input.recoveryToken 同真同假（上一段落派生），
    // 判它即可让编译器在分支内确认摘要非空，无需 `!` 断言。
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
    // 同一连接上重复注册（典型路径：注册 ack 超时后客户端未存到令牌、用户再点一次“进入”）
    // 必须复用现有身份：否则旧身份仍 connected:true 且 socket 指向同一存活连接，
    // 而 handleDisconnect 只按 socket.data.playerId 匹配，旧身份永不回收；
    // 并使按身份存储的限频、私密房码枚举上限与邀请冷却形同虚设。
    const boundId = socket.data.playerId
    const bound = boundId ? this.context.players.get(boundId) : undefined
    if (bound && bound.socketId === socket.id) {
      bound.preferences = input.preferences
      this.context.logger.info({ playerId: bound.id }, '玩家在同一连接上重复注册，已复用身份')
      return this.rotateAndReclaimPlayer(socket, bound)
    }
    // 公开 playerId 绝不能用于恢复身份，否则大厅中的任意玩家都可据此接管他人座位。
    // 全新注册：生成随机昵称去重、UUID 身份、随机恢复令牌
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
    // 身份持久化：准备变更后先落盘，保证跨重启仍可按令牌恢复同一 UUID；失败则不污染内存与 socket。
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
    // 头像编号防御性校验：持久化值若因版本升级脱离白名单，不恢复、走全新注册。
    if (!isAvatarId(record.avatarId)) return undefined
    const player: PlayerSecret = {
      id: record.id,
      tokenDigest: record.tokenDigest,
      profile: {
        nickname: record.nickname,
        // 上方 isAvatarId(record.avatarId) 守卫已把 string 收窄为 AvatarId，无需再断言
        avatarId: record.avatarId,
      },
      preferences: {
        discoverable: record.discoverable,
        acceptsInvites: record.acceptsInvites,
      },
      // 恢复后仍是「断线待接管」状态：reclaimPlayer 会清除 disconnectedAt 并绑定新 socket。
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

  recoverOnStartup(): void {
    // 先清理「上一次运行前就已超过恢复宽限期」的过期身份行，防止 players 表随重启无限增长；
    // 再把剩余行（含崩溃时 connected=1 的行）全部标记为断线，给它们一个全新的恢复宽限窗口。
    this.context.repositories.players.deleteStaleDisconnected(
      this.context.clock.now() - APP_CONFIG.network.reconnectGraceMs,
    )
    // 房间从不跨进程恢复；全部玩家视为断线，开始新的身份宽限计时。
    this.context.repositories.players.markAllDisconnected(this.context.clock.now())
  }

  private reclaimPlayer(
    socket: AppSocket,
    player: PlayerSecret,
    recoveryToken: string,
  ): Omit<SessionRegistration, 'room'> {
    this.context.scheduler.clear(player.disconnectTimer)
    const previousSocket = player.socket
    // 必须先把身份指向新 socket，再断开旧连接；否则旧 socket 的 disconnect 若同步/抢先触发，
    // 会被误认为当前连接断线并执行离房，造成恢复成功后仍偶发回大厅或登录页。
    player.socket = socket
    player.socketId = socket.id
    player.connected = true
    if (previousSocket && previousSocket.id !== socket.id) previousSocket.disconnect(true)
    delete player.disconnectedAt
    delete player.disconnectTimer
    this.bindSocketSession(socket, player)
    // Socket.IO 可能恢复了旧传输会话的业务房间；先按领域权威状态清空，再只加入当前 roomId，
    // 避免「服务端已离房，但新 socket 仍订阅旧房间广播」的跨房间信息泄露。
    for (const joinedRoomId of socket.rooms) {
      if (joinedRoomId !== socket.id) void socket.leave(joinedRoomId)
    }
    // 恢复连接可能丢失过增量广播，强制下次快照对画布全量下发
    const room = player.roomId ? this.context.rooms.get(player.roomId) : undefined
    if (room) {
      const member = room.members.find((item) => item.playerId === player.id)
      if (member) invalidateMemberCanvasSync(member)
    }
    this.joinSocketRoom(player) // 重新加入 Socket 房间，恢复广播接收
    if (player.roomId) this.context.emitRoom(player.roomId) // 重新推送房间快照，恢复对局视图
    // 只有「对局进行中断线且席位被保留」才通知同局其他在线成员；本人由连接恢复模态框反馈。
    if (room && player.drawingDisconnectRoomId === room.id) {
      const payload: MemberConnectionChange = {
        playerId: player.id,
        nickname: player.profile.nickname,
        connection: 'online',
      }
      // 经端口广播给房间其他成员（排除本人连接）：模块不再伸手到传输层 socket.to。
      this.context.emitRoomEventExcept(
        room.id,
        socket.id,
        EVENTS.roomMemberConnectionChanged,
        createServerPush(EVENTS.roomMemberConnectionChanged, payload),
      )
    }
    delete player.drawingDisconnectRoomId
    // 重新上线：只持久化连接状态；房间归属始终由当前进程内模型维护。
    this.context.persistPlayer(player)
    this.context.broadcastPresence()
    return {
      player: this.context.toPublicPlayer(player),
      recoveryToken,
      restored: true,
    }
  }

  /**
   * 玩家主动注销会话：**先原子吊销持久化令牌，再离房与清理内存**（见 docs/adr/0011-session-logout-atomicity.md）。
   *
   * 顺序即原子性：持久化删除是唯一可失败的步骤，失败时立即中止并抛统一 INTERNAL_ERROR
   * （白名单日志只记错误类型与 playerId），内存身份、令牌索引与当前连接全部保持可用——
   * 绝不允许出现「库里旧令牌仍有效、内存身份已删除」的分裂状态（那会让注销后的令牌仍能在重启后
   * 复活一个用户以为已删除的身份）。持久化成功之后的步骤都不再抛错：离房失败只记日志，
   * 因为房间状态问题不能反过来让注销半途而废。
   */
  logout(socket: AppSocket): void {
    const playerId = socket.data.playerId
    if (!playerId) return
    const player = this.context.players.get(playerId)
    // 只有当前连接可以注销自己的身份：被新连接接管后的旧 socket 迟到注销只解绑自己，
    // 否则会连带删除新会话的身份与持久化记录（与 handleDisconnect 的归属判断保持一致）。
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
      throw new GameError('INTERNAL_ERROR')
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

  /**
   * 绑定 socket 会话：写入身份并把幂等缓存切换为该玩家的玩家级缓存。
   * 缓存归属由本服务唯一管理（此前由 handler 越过 GameService 接口直读玩家册再挂到 socket.data）。
   */
  private bindSocketSession(socket: AppSocket, player: PlayerSecret): void {
    socket.data.playerId = player.id
    socket.data.requestCache = player.requestCache
  }

  /** 解绑当前 Socket 的会话引用：清空玩家绑定与请求缓存，并广播一次在线状态。 */
  private detachSocket(socket: AppSocket): void {
    delete socket.data.playerId
    socket.data.requestCache = new Map()
    this.context.broadcastPresence()
  }

  updateProfile(playerId: string, profile: Profile): PublicPlayer {
    const player = this.context.requirePlayer(playerId)
    // 房间内锁定资料，避免对局期间玩家频繁改名干扰其他成员辨识
    if (player.roomId) throw new GameError('PROFILE_LOCKED', serverStrings.errors.PROFILE_LOCKED)
    // avatarId 白名单裁决同注册路径：协议枚举收窄后服务层不重复校验。
    // 改名后需要重新做唯一性校验（排除自己当前占用）
    player.profile = {
      nickname: this.makeUniqueNickname(this.cleanNickname(profile.nickname), player.id),
      avatarId: profile.avatarId,
    }
    // 持久化：资料更新后同步数据库（服务重启后仍保持最新昵称/头像）。
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
    // 持久化：偏好更新后同步数据库。
    this.context.persistPlayer(player)
    this.context.broadcastPresence()
  }

  handleDisconnect(socket: AppSocket): void {
    // 断线编排（离房/结算/阶段转换/计时器）没有 ack 承载错误：任何抛出都会成为未捕获异常
    // 打断进程并丢失全部内存态；统一经 safeRun 降级为白名单日志（与计时器回调同一纪律）。
    this.context.safeRun('handleDisconnect', () => this.handleDisconnectInternal(socket))
  }

  private handleDisconnectInternal(socket: AppSocket): void {
    const playerId = socket.data.playerId
    if (!playerId) return
    // 只处理当前连接对应的身份，防止被新连接接管后的旧 socket 迟到断开误伤当前会话。
    const player = this.context.players.get(playerId)
    if (!player || player.socketId !== socket.id) return
    const room = player.roomId ? this.context.rooms.get(player.roomId) : undefined
    // 席位保留口径（ADR-0059 统一断线挂机化）：
    // 只要对局正在进行中（经典模式与接龙模式全阶段，含 starting 与 game_result），
    // 席位全程保留在房间内，断线玩家视作挂机玩家，不执行立即离房，由各阶段倒计时大扫掠统一兜底。
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

    if (room && retainsSeat) this.retainMatchSeat(player, room, generation)
    else {
      delete player.drawingDisconnectRoomId
      // 非作画阶段不保留房间席位：统一走标准离房流程，确保准备、房主迁移、选词画家离开
      // 与空房关闭等所有领域副作用完整执行；身份和秘密恢复令牌仍保留到玩家级宽限结束。
      if (room)
        this.context.leaveRoom(
          playerId,
          serverStrings.notices.playerDisconnectedLeave(player.profile.nickname),
        )
    }

    this.scheduleIdentityGrace(playerId)
    this.context.broadcastPresence()
  }

  /** 持久化连接状态与断线时间：跨重启宽限判断依赖它（宽限内可凭令牌恢复）。失败只记日志。 */
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

  /**
   * 对局阶段断线保席：作废画布游标、广播重连提示，并为房主安排短宽限计时器。
   * 接龙局进行中（动手期 + 展示 / 投票期）走同一保席路径：席位于断线期间保留在房间里（链位不受影响）。
   * 断线者一律按挂机对待：不安排任何提前代交或提前废弃，全部由各阶段倒计时到点的大扫掠兜底
   *（见 docs/adr/0059-remove-game-pause-and-unified-offline-handling.md）；
   * 只有房主控制权会在短宽限后迁移给在线可玩成员，其余现场一律不动。
   */
  private retainMatchSeat(player: PlayerSecret, room: RoomSecret, generation: number): void {
    const playerId = player.id
    player.drawingDisconnectRoomId = room.id
    // 断线期间可能丢失增量广播，重连后的首份快照必须携带完整画布历史。
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

    // 对局中房主掉线时暂留控制权；短宽限后仍未恢复才迁移给在线可玩成员。
    if (room.hostId === playerId) {
      this.context.scheduler.set(APP_CONFIG.network.hostReconnectGraceMs, () =>
        this.context.safeRun('hostReconnectTimeout', () => {
          if (
            !this.isSameDisconnectEpisode(player, generation, room.id) ||
            room.hostId !== playerId ||
            room.members.length <= 1
          )
            return
          this.context.transferDisconnectedHost(room, playerId)
        }),
      )
    }
    this.context.emitRoom(room.id)
  }

  /** 身份级宽限与房间席位分离：非对局阶段虽已离房，仍可凭令牌恢复同一 UUID 后进入大厅。 */
  private scheduleIdentityGrace(playerId: string): void {
    const player = this.context.players.get(playerId)
    if (!player) return
    player.disconnectTimer = this.context.scheduler.set(APP_CONFIG.network.reconnectGraceMs, () =>
      this.context.safeRun('expireDisconnectedPlayer', () =>
        this.expireDisconnectedPlayer(playerId),
      ),
    )
  }

  /** 同一断线事件的判定：generation 未变、仍在同一房间、且仍未重连。 */
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
    // 恢复宽限期结束仍断线：离开房间并删除身份
    const player = this.context.players.get(playerId)
    if (!player || player.connected) return
    if (player.roomId)
      this.context.leaveRoom(playerId, serverStrings.notices.playerReconnectedTimeout)
    this.context.players.delete(player.id)
    this.context.playersByTokenDigest.delete(player.tokenDigest)
    // 身份宽限结束：从数据库删除该玩家记录（后续需重建身份）。
    this.context.repositories.players.remove(player.id)
    this.context.broadcastPresence()
  }

  private cleanNickname(value: string): string {
    // 剔除控制字符（换行、零宽字符等），防止昵称破坏聊天排版
    const clean = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
    // 按用户可见字符（Unicode grapheme cluster）计数校验长度
    const length = countGraphemes(clean)
    if (
      length < APP_CONFIG.player.nicknameMinLength ||
      length > APP_CONFIG.player.nicknameMaxLength
    ) {
      throw new GameError(
        'INVALID_NICKNAME',
        serverStrings.errors.INVALID_NICKNAME(
          APP_CONFIG.player.nicknameMinLength,
          APP_CONFIG.player.nicknameMaxLength,
        ),
      )
    }
    return truncateGraphemes(clean, APP_CONFIG.player.nicknameMaxLength)
  }

  private makeUniqueNickname(value: string, exceptId?: string): string {
    // 收集当前全部玩家的昵称（排除自己），用于重名检测
    const occupied = new Set(
      [...this.context.players.values()]
        .filter((player) => player.id !== exceptId)
        .map((player) => normalizeAnswer(player.profile.nickname)),
    )
    if (!occupied.has(normalizeAnswer(value))) return value
    // 重名时追加数字后缀（2～99），且保证裁剪后不超出昵称长度上限
    for (let suffix = 2; suffix <= 99; suffix += 1) {
      const base = truncateGraphemes(
        value,
        APP_CONFIG.player.nicknameMaxLength - String(suffix).length,
      )
      const candidate = `${base}${suffix}`
      if (!occupied.has(normalizeAnswer(candidate))) return candidate
    }
    throw new GameError('DUPLICATE_NICKNAME', serverStrings.errors.DUPLICATE_NICKNAME)
  }

  private joinSocketRoom(player: PlayerSecret): void {
    if (player.roomId) void player.socket?.join(player.roomId)
  }
}
