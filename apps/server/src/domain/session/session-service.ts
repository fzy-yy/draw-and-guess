import {
  EVENTS,
  countGraphemes,
  createServerPush,
  normalizeAnswer,
  truncateGraphemes,
  type MemberConnectionChange,
  type Profile,
  type PublicPlayer,
  type SessionRegistration,
} from '@draw-guess/shared'
import type { Socket } from 'socket.io'
import { APP_CONFIG } from '../../config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import { GameError, type RuntimeLogger } from '../../errors.ts'
import type { PlayerSecret, RoomSecret } from '../../models.ts'
import type { PlayerRecord, PlayerRepository, RoomRepository } from '../../repositories/index.ts'
import { type RuntimeDependencies } from '../../runtime.ts'

/** 仅暴露本用例需要的数据与副作用端口；由应用层连接跨用例动作。 */
export interface SessionServiceContext {
  broadcastPresence(): void
  clock: RuntimeDependencies['clock']
  emitRoom(roomId?: string): void
  emitRoomEvent(roomId: string, event: string, payload: unknown): void
  finishRound(room: RoomSecret, drawerAbandoned: boolean): void
  leaveRoom(playerId: string, reason?: string): void
  logger: RuntimeLogger
  persistPlayer(player: PlayerSecret): void
  players: Map<string, PlayerSecret>
  playersByToken: Map<string, PlayerSecret>
  random: RuntimeDependencies['random']
  repositories: {
    players: Pick<
      PlayerRepository,
      | 'findByToken'
      | 'clearAllRoomIds'
      | 'deleteStaleDisconnected'
      | 'markAllDisconnected'
      | 'remove'
      | 'setConnection'
    >
    rooms: Pick<RoomRepository, 'listRooms' | 'removeRoom'>
  }
  requirePlayer(playerId: string): PlayerSecret
  rooms: Map<string, RoomSecret>
  transferDisconnectedHost(room: RoomSecret, playerId: string): void
  safeRun(label: string, fn: () => void): void
  scheduler: RuntimeDependencies['scheduler']
  toPublicPlayer(player: PlayerSecret): PublicPlayer
}

export class SessionService {
  constructor(private readonly context: SessionServiceContext) {}
  register(
    socket: Socket,
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
    // 头像编号已由共享 Zod 白名单校验；服务层再次防御性确认，拒绝任意资源路径或 URL。
    if (!(APP_CONFIG.player.avatarIds as readonly string[]).includes(input.profile.avatarId))
      throw new GameError('INVALID_AVATAR_ID', serverStrings.errors.INVALID_AVATAR_ID)

    // 携带恢复令牌且仍处于宽限期内的玩家：复用原身份与座位（如仍在房间）
    const recovering = input.recoveryToken
      ? this.context.playersByToken.get(input.recoveryToken)
      : undefined
    if (
      recovering &&
      (!recovering.disconnectedAt ||
        this.context.clock.now() - recovering.disconnectedAt <= APP_CONFIG.network.reconnectGraceMs)
    ) {
      return this.reclaimPlayer(socket, recovering)
    }
    // 内存索引未命中时回退查持久化记录：服务重启后 playersByToken 为空，
    // 但 SQLite 中的身份行（含令牌）仍在；只要记录断线时间仍在宽限期内，
    // 就从持久化记录重建内存身份，实现真正的「跨重启凭令牌恢复同一 UUID」。
    // （房间席位不恢复：进行中局在重启时已被作废，恢复后回到大厅。）
    if (!recovering && input.recoveryToken) {
      const record = this.context.repositories.players.findByToken(input.recoveryToken)
      const withinGrace =
        record?.disconnectedAt !== undefined &&
        this.context.clock.now() - record.disconnectedAt <= APP_CONFIG.network.reconnectGraceMs
      if (record && withinGrace) {
        const restored = this.restorePlayerFromRecord(record)
        if (restored) return this.reclaimPlayer(socket, restored)
      }
    }
    // 同一连接上重复注册（典型路径：注册 ack 超时后客户端未存到令牌、用户再点一次“进入”）
    // 必须复用现有身份：否则旧身份仍 connected:true 且 socket 指向同一存活连接，
    // 而 handleDisconnect 只按 socket.data.playerId 匹配，旧身份永不回收；
    // 并使按身份存储的限频、私密房码枚举上限与邀请冷却形同虚设。
    const boundId = socket.data.playerId as string | undefined
    const bound = boundId ? this.context.players.get(boundId) : undefined
    if (bound && bound.socketId === socket.id) {
      bound.preferences = input.preferences
      this.context.logger.info({ playerId: bound.id }, '玩家在同一连接上重复注册，已复用身份')
      return {
        player: this.context.toPublicPlayer(bound),
        recoveryToken: bound.token,
        restored: true,
      }
    }
    // 公开 playerId 绝不能用于恢复身份，否则大厅中的任意玩家都可据此接管他人座位。
    // 全新注册：生成随机昵称去重、UUID 身份、随机恢复令牌
    const nickname = this.makeUniqueNickname(this.cleanNickname(input.profile.nickname))
    const player: PlayerSecret = {
      id: this.context.random.uuid(),
      token: this.context.random.token(32),
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
    socket.data.playerId = player.id
    this.context.players.set(player.id, player)
    this.context.playersByToken.set(player.token, player)
    this.context.logger.info({ playerId: player.id }, '玩家会话已注册')
    this.context.broadcastPresence()
    return {
      player: this.context.toPublicPlayer(player),
      recoveryToken: player.token,
      restored: false,
    }
  }

  private restorePlayerFromRecord(record: PlayerRecord): PlayerSecret | undefined {
    // 头像编号防御性校验：持久化值若因版本升级脱离白名单，不恢复、走全新注册。
    if (!(APP_CONFIG.player.avatarIds as readonly string[]).includes(record.avatarId))
      return undefined
    const player: PlayerSecret = {
      id: record.id,
      token: record.token,
      profile: {
        nickname: record.nickname,
        avatarId: record.avatarId as PlayerSecret['profile']['avatarId'],
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
    this.context.playersByToken.set(player.token, player)
    this.context.logger.info({ playerId: player.id }, '玩家身份已从持久化记录恢复')
    return player
  }

  recoverOnStartup(): void {
    // 作废全部进行中房间：对局在内存，重启即数据丢失，作废关闭避免残留。
    // 必须在清理过期玩家之前执行，确保 room_members 从表先清空，避免外键依赖阻碍玩家清理。
    for (const room of this.context.repositories.rooms.listRooms()) {
      this.context.repositories.rooms.removeRoom(room.id)
    }
    this.context.repositories.players.clearAllRoomIds()

    // 先清理「上一次运行前就已超过恢复宽限期」的过期身份行，防止 players 表随重启无限增长；
    // 再把剩余行（含崩溃时 connected=1 的行）全部标记为断线，给它们一个全新的恢复宽限窗口。
    this.context.repositories.players.deleteStaleDisconnected(
      this.context.clock.now() - APP_CONFIG.network.reconnectGraceMs,
    )
    // 全部玩家视为断线，开始身份宽限计时（宽限期由 APP_CONFIG.network.reconnectGraceMs 定义）。
    this.context.repositories.players.markAllDisconnected(this.context.clock.now())
  }

  private reclaimPlayer(socket: Socket, player: PlayerSecret): Omit<SessionRegistration, 'room'> {
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
    socket.data.playerId = player.id
    // Socket.IO 可能恢复了旧传输会话的业务房间；先按领域权威状态清空，再只加入当前 roomId，
    // 避免「服务端已离房，但新 socket 仍订阅旧房间广播」的跨房间信息泄露。
    for (const joinedRoomId of socket.rooms) {
      if (joinedRoomId !== socket.id) socket.leave(joinedRoomId)
    }
    // 恢复连接可能丢失过增量广播，强制下次快照对画布全量下发
    const room = player.roomId ? this.context.rooms.get(player.roomId) : undefined
    if (room) {
      const member = room.members.find((item) => item.playerId === player.id)
      if (member) member.lastSyncedSeq = undefined
    }
    this.joinSocketRoom(player) // 重新加入 Socket 房间，恢复广播接收
    this.context.emitRoom(player.roomId) // 重新推送房间快照，恢复对局视图
    // 只有「作画阶段断线且席位被保留」才通知同局其他在线成员；本人由连接恢复模态框反馈。
    if (room && player.drawingDisconnectRoomId === room.id) {
      const payload: MemberConnectionChange = {
        playerId: player.id,
        nickname: player.profile.nickname,
        connection: 'online',
      }
      socket.to(room.id).emit(EVENTS.roomMemberConnectionChanged, createServerPush(payload))
    }
    delete player.drawingDisconnectRoomId
    // 重新上线：持久化连接状态与房间归属，保证跨重启宽限判断正确。
    this.context.persistPlayer(player)
    this.context.broadcastPresence()
    return {
      player: this.context.toPublicPlayer(player),
      recoveryToken: player.token,
      restored: true,
    }
  }

  logout(socket: Socket): void {
    const playerId = socket.data.playerId as string | undefined
    if (playerId) {
      const player = this.context.players.get(playerId)
      if (player) {
        this.context.scheduler.clear(player.disconnectTimer)
        if (player.roomId) {
          try {
            this.context.leaveRoom(playerId)
          } catch (err) {
            this.context.logger.error({ err, playerId }, '玩家注销离房失败')
          }
        }
        this.context.players.delete(playerId)
        this.context.playersByToken.delete(player.token)
        try {
          this.context.repositories.players.remove(playerId)
        } catch (err) {
          this.context.logger.error({ err, playerId }, '清理玩家持久化记录失败')
        }
      }
      delete socket.data.playerId
      socket.data.requestCache = new Map()
      this.context.broadcastPresence()
    }
  }

  updateProfile(playerId: string, profile: Profile): PublicPlayer {
    const player = this.context.requirePlayer(playerId)
    // 房间内锁定资料，避免对局期间玩家频繁改名干扰其他成员辨识
    if (player.roomId) throw new GameError('PROFILE_LOCKED', serverStrings.errors.PROFILE_LOCKED)
    if (!(APP_CONFIG.player.avatarIds as readonly string[]).includes(profile.avatarId))
      throw new GameError('INVALID_AVATAR_ID', serverStrings.errors.INVALID_AVATAR_ID)
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

  handleDisconnect(socket: Socket): void {
    const playerId = socket.data.playerId as string | undefined
    if (!playerId) return
    // 只处理当前连接对应的身份，防止被新连接接管后的旧 socket 迟到断开误伤当前会话。
    const player = this.context.players.get(playerId)
    if (!player || player.socketId !== socket.id) return
    const room = player.roomId ? this.context.rooms.get(player.roomId) : undefined
    // 暂停中的作画仍是同一未完成回合；只有暂停前阶段确为 drawing 才保留席位。
    const retainDrawingSeat =
      room?.phase === 'drawing' ||
      (room?.phase === 'paused' && room.game?.phaseBeforePause === 'drawing')
    player.disconnectGeneration += 1
    const disconnectGeneration = player.disconnectGeneration

    player.connected = false
    player.socket = undefined
    player.socketId = undefined
    player.disconnectedAt = this.context.clock.now()
    // 持久化连接状态与断线时间：跨重启宽限判断依赖它（宽限内可凭令牌恢复）。
    try {
      this.context.repositories.players.setConnection(player.id, false, player.disconnectedAt)
    } catch (err) {
      this.context.logger.error({ err, playerId: player.id }, '断线状态持久化异常')
    }
    this.context.logger.info(
      { playerId, roomId: player.roomId, retainedSeat: retainDrawingSeat },
      retainDrawingSeat ? '玩家作画阶段断线并保留席位' : '玩家断线并进入身份恢复宽限',
    )

    if (room && retainDrawingSeat) {
      player.drawingDisconnectRoomId = room.id
      // 断线期间可能丢失增量广播，重连后的首份快照必须携带完整画布历史。
      const member = room.members.find((item) => item.playerId === playerId)
      if (member) member.lastSyncedSeq = undefined
      const payload: MemberConnectionChange = {
        playerId,
        nickname: player.profile.nickname,
        connection: 'reconnecting',
      }
      this.context.emitRoomEvent(
        room.id,
        EVENTS.roomMemberConnectionChanged,
        createServerPush(payload),
      )

      // 当前画家断线：保留短宽限；超时仍未恢复则由权威状态机废弃本回合。
      // 宽限期间房间可能被暂停（保留席位语义仍指向作画），因此暂停中同样认定「本回合未完成」：
      // 否则超时回调因阶段不是 drawing 而静默跳过，恢复后回合将无人作画直至自然超时。
      if (room.game?.drawerId === playerId) {
        this.context.scheduler.set(APP_CONFIG.network.drawerReconnectGraceMs, () =>
          this.context.safeRun('drawerReconnectTimeout', () => {
            const phaseIsRoundDrawing =
              room.phase === 'drawing' ||
              (room.phase === 'paused' && room.game?.phaseBeforePause === 'drawing')
            if (
              !player.connected &&
              player.disconnectGeneration === disconnectGeneration &&
              player.roomId === room.id &&
              room.game?.drawerId === playerId &&
              phaseIsRoundDrawing
            )
              this.context.finishRound(room, true)
          }),
        )
      }
      // 作画期房主掉线时暂留控制权；短宽限后仍未恢复才迁移给在线可玩成员。
      if (room.hostId === playerId) {
        this.context.scheduler.set(APP_CONFIG.network.drawerReconnectGraceMs, () =>
          this.context.safeRun('hostReconnectTimeout', () => {
            if (
              player.connected ||
              player.disconnectGeneration !== disconnectGeneration ||
              player.roomId !== room.id ||
              room.hostId !== playerId ||
              room.members.length <= 1
            )
              return
            this.context.transferDisconnectedHost(room, playerId)
          }),
        )
      }
      this.context.emitRoom(room.id)
    } else {
      delete player.drawingDisconnectRoomId
      // 非作画阶段不保留房间席位：统一走标准离房流程，确保准备、房主迁移、选词画家离开
      // 与空房关闭等所有领域副作用完整执行；身份和秘密恢复令牌仍保留到玩家级宽限结束。
      if (room)
        this.context.leaveRoom(
          playerId,
          serverStrings.notices.playerDisconnectedLeave(player.profile.nickname),
        )
    }

    // 身份级宽限与房间席位分离：非作画阶段虽已离房，仍可凭令牌恢复同一 UUID 后进入大厅。
    player.disconnectTimer = this.context.scheduler.set(APP_CONFIG.network.reconnectGraceMs, () =>
      this.context.safeRun('expireDisconnectedPlayer', () =>
        this.expireDisconnectedPlayer(playerId),
      ),
    )
    this.context.broadcastPresence()
  }

  private expireDisconnectedPlayer(playerId: string): void {
    // 恢复宽限期结束仍断线：离开房间并删除身份
    const player = this.context.players.get(playerId)
    if (!player || player.connected) return
    if (player.roomId)
      this.context.leaveRoom(playerId, serverStrings.notices.playerReconnectedTimeout)
    this.context.players.delete(player.id)
    this.context.playersByToken.delete(player.token)
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
    if (player.roomId) player.socket?.join(player.roomId)
  }
}
