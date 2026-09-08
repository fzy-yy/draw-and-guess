import {
  EVENTS,
  createServerPush,
  type MemberConnectionChange,
  type RoomPhase,
  type RoomSettings,
  type RoomSnapshot,
  type RoomVisibility,
} from '@draw-guess/shared'
import { APP_CONFIG } from '../../config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import { GameError, type RuntimeLogger } from '../../errors.ts'
import type { GameSecret, MemberState, PlayerSecret, RoomSecret } from '../../models.ts'
import type { RoomRepository } from '../../repositories/index.ts'
import { type RuntimeDependencies } from '../../runtime.ts'
import type { VocabularyRegistry, VocabularyStore } from '../../vocabulary/index.ts'

/** 仅暴露本用例需要的数据与副作用端口；由应用层连接跨用例动作。 */
export interface RoomMembershipServiceContext {
  abandonChoosing(room: RoomSecret, notice: string): void
  addSystemNotice(room: RoomSecret, text: string): void
  broadcastPresence(): void
  clearHintTimers(game: GameSecret): void
  clock: RuntimeDependencies['clock']
  emitRoom(roomId?: string): void
  emitRoomEvent(roomId: string, event: string, payload: unknown): void
  emitToPlayer(playerId: string, event: string, payload: unknown): void
  finishRound(room: RoomSecret, drawerAbandoned: boolean): void
  getRoomVocabularyStore(room?: RoomSecret): VocabularyStore
  isPlaying(phase: RoomPhase): boolean
  logger: RuntimeLogger
  pauseRoomInternal(room: RoomSecret, reason: string): void
  persistPlayer(player: PlayerSecret): void
  persistRoom(room: RoomSecret): void
  players: Map<string, PlayerSecret>
  random: RuntimeDependencies['random']
  repositories: { rooms: Pick<RoomRepository, 'removeRoom'> }
  requirePlayer(playerId: string): PlayerSecret
  rooms: Map<string, RoomSecret>
  roomsByPrivateCode: Map<string, string>
  scheduler: RuntimeDependencies['scheduler']
  setWaiting(room: RoomSecret, notice: string, resetReady?: boolean): void
  snapshot(room: RoomSecret, playerId: string): RoomSnapshot
  transition(room: RoomSecret, next: RoomPhase): void
  validateSettings(settings: RoomSettings): void
  vocabulary: VocabularyRegistry
}

export class RoomMembershipService {
  constructor(private readonly context: RoomMembershipServiceContext) {}
  /** 断线代次与宽限期由会话用例校验，迁移规则与持久化由成员用例统一维护。 */
  transferDisconnectedHost(room: RoomSecret, playerId: string): void {
    const candidate = room.members.find(
      (member) =>
        member.playerId !== playerId &&
        !member.spectating &&
        !member.leftGame &&
        this.context.players.get(member.playerId)?.connected,
    )
    if (!candidate) return
    room.hostId = candidate.playerId
    this.rotatePrivateJoinCode(room)
    room.stateVersion += 1
    this.context.addSystemNotice(
      room,
      serverStrings.notices.hostMigratedTimeout(
        this.context.players.get(candidate.playerId)?.profile.nickname ??
          serverStrings.notices.hostFallback,
      ),
    )
    this.context.persistRoom(room)
    this.context.emitRoom(room.id)
  }
  createRoom(
    playerId: string,
    input: { name: string; visibility: RoomVisibility; settings: RoomSettings },
  ): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId) // 玩家必须不在其他房间
    this.context.validateSettings(input.settings)
    const privateJoinCode =
      input.visibility === 'private' ? this.generatePrivateJoinCode() : undefined
    // 新房间默认选择词数最多的词库并全选其词条，成员只有房主一人，状态版本从 1 开始。
    const defaultPackageId =
      'defaultPackageId' in this.context.vocabulary
        ? this.context.vocabulary.defaultPackageId
        : undefined
    const defaultStore = this.context.getRoomVocabularyStore()
    const room: RoomSecret = {
      id: this.context.random.uuid(),
      name: input.name.trim(),
      hostId: player.id,
      visibility: input.visibility,
      ...(privateJoinCode ? { privateJoinCode } : {}),
      phase: 'waiting',
      stateVersion: 1,
      settings: input.settings,
      members: [],
      vocabularyPackageId: defaultPackageId,
      selectedWordIds: new Set(defaultStore.items.map((word) => word.id)),
      createdAt: this.context.clock.now(),
    }
    room.members.push(this.createMember(player, room))
    // 持久化优先：先写数据库，成功后再提交到内存 Map 与加入 Socket 房间
    player.roomId = room.id
    try {
      this.context.persistRoom(room)
      this.context.persistPlayer(player)
    } catch (err) {
      delete player.roomId
      throw err
    }
    this.context.rooms.set(room.id, room)
    if (privateJoinCode) this.context.roomsByPrivateCode.set(privateJoinCode, room.id)
    this.context.logger.info(
      { roomId: room.id, playerId, visibility: room.visibility },
      '房间已创建',
    )
    player.socket?.join(room.id)
    this.context.emitRoom(room.id)
    this.context.broadcastPresence()
    return this.context.snapshot(room, player.id)
  }

  joinRoom(playerId: string, roomId: string): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId)
    const room = this.context.rooms.get(roomId)
    if (!room || room.phase === 'closed' || room.visibility !== 'public')
      throw new GameError('ROOM_NOT_FOUND', serverStrings.errors.ROOM_NOT_FOUND)
    return this.joinResolvedRoom(player, room, 'public')
  }

  joinPrivateRoom(playerId: string, code: string): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId)
    const now = this.context.clock.now()
    player.privateJoinAttemptTimes = player.privateJoinAttemptTimes.filter(
      (timestamp) => now - timestamp < APP_CONFIG.room.privateJoinWindowMs,
    )
    if (player.privateJoinAttemptTimes.length >= APP_CONFIG.room.privateJoinMaxAttempts)
      throw new GameError('RATE_LIMITED', serverStrings.errors.RATE_LIMITED_PRIVATE_JOIN)
    player.privateJoinAttemptTimes.push(now)
    const roomId = this.context.roomsByPrivateCode.get(code)
    const room = roomId ? this.context.rooms.get(roomId) : undefined
    if (!room || room.phase === 'closed' || room.visibility !== 'private')
      throw new GameError('PRIVATE_ROOM_NOT_FOUND', serverStrings.errors.PRIVATE_ROOM_NOT_FOUND)
    player.privateJoinAttemptTimes = []
    return this.joinResolvedRoom(player, room, 'private-code')
  }

  public joinResolvedRoom(
    player: PlayerSecret,
    room: RoomSecret,
    source: 'public' | 'private-code' | 'invite',
  ): RoomSnapshot {
    if (room.members.some((member) => member.playerId === player.id && member.leftGame))
      throw new GameError('GAME_ALREADY_LEFT', serverStrings.errors.GAME_ALREADY_LEFT)
    const activeMembers = room.members.filter((member) => !member.leftGame)
    if (activeMembers.length >= room.settings.maxPlayers)
      throw new GameError('ROOM_FULL', serverStrings.errors.ROOM_FULL)
    const spectating = room.phase !== 'waiting'
    if (spectating) {
      if (room.settings.joinPolicy === 'forbid')
        throw new GameError('GAME_IN_PROGRESS', serverStrings.errors.GAME_IN_PROGRESS_FORBID)
      if (room.settings.joinPolicy === 'next_game')
        throw new GameError('GAME_IN_PROGRESS', serverStrings.errors.GAME_IN_PROGRESS_NEXT)
      const member = this.createMember(player, room, true)
      const previousVersion = room.stateVersion
      room.members.push(member)
      room.stateVersion += 1
      this.context.logger.info(
        { roomId: room.id, playerId: player.id, source },
        '玩家以观战身份加入房间',
      )
      player.roomId = room.id
      player.socket?.join(room.id)
      // 持久化：成员席位与玩家房间归属。
      try {
        this.context.persistPlayer(player)
        this.context.persistRoom(room)
      } catch (error) {
        room.members = room.members.filter((item) => item !== member)
        room.stateVersion = previousVersion
        delete player.roomId
        player.socket?.leave(room.id)
        try {
          this.context.persistPlayer(player)
        } catch (rollbackError) {
          this.context.logger.error(
            { rollbackError, playerId: player.id, roomId: room.id },
            '房间加入失败后的玩家归属回滚失败',
          )
        }
        throw error
      }
      this.context.emitRoom(room.id)
      this.context.broadcastPresence()
      return this.context.snapshot(room, player.id)
    }
    const member = this.createMember(player, room)
    const previousVersion = room.stateVersion
    room.members.push(member)
    room.stateVersion += 1
    this.context.logger.info({ roomId: room.id, playerId: player.id, source }, '玩家已加入房间')
    player.roomId = room.id
    player.socket?.join(room.id)
    // 持久化：成员席位与玩家房间归属。
    try {
      this.context.persistPlayer(player)
      this.context.persistRoom(room)
    } catch (error) {
      room.members = room.members.filter((item) => item !== member)
      room.stateVersion = previousVersion
      delete player.roomId
      player.socket?.leave(room.id)
      try {
        this.context.persistPlayer(player)
      } catch (rollbackError) {
        this.context.logger.error(
          { rollbackError, playerId: player.id, roomId: room.id },
          '房间加入失败后的玩家归属回滚失败',
        )
      }
      throw error
    }
    // 成员加入只改变席位和状态版本，不取消其他玩家已经完成的准备。
    this.context.addSystemNotice(room, serverStrings.notices.playerJoined(player.profile.nickname))
    this.context.emitRoom(room.id)
    this.context.broadcastPresence()
    return this.context.snapshot(room, player.id)
  }

  leaveRoom(playerId: string, reason: string = serverStrings.notices.leaveReasonDefault): void {
    const player = this.context.requirePlayer(playerId)
    if (!player.roomId) {
      return
    }
    const room = this.context.rooms.get(player.roomId)
    if (!room) {
      delete player.roomId // 房间已不存在，仅清理玩家引用
      return
    }
    player.socket?.leave(room.id)
    room.members = room.members.filter((member) => member.playerId !== playerId)
    if (room.phase === 'waiting') {
      room.members.forEach((member, index) => {
        member.seatIndex = index
      })
    }
    this.context.logger.info({ roomId: room.id, playerId, reason }, '玩家已离开房间')
    delete player.roomId
    room.stateVersion += 1
    // 持久化：玩家离房清空房间归属，房间成员席位移除该玩家。
    this.context.persistPlayer(player)
    this.context.persistRoom(room)

    // 空房间直接关闭；房主离开时迁移控制权；倒计时/等待/对局各有对应处理
    if (room.members.length === 0) {
      this.closeRoom(room, serverStrings.notices.closeRoomEmpty)
      return
    }
    if (room.hostId === playerId && !this.transferHostInternal(room)) {
      this.closeRoom(room, serverStrings.notices.closeRoomNoPlayableHost)
      return
    }
    if (room.phase === 'starting')
      this.context.setWaiting(room, serverStrings.notices.countdownCanceled, false)
    else if (room.phase === 'waiting')
      this.context.addSystemNotice(room, serverStrings.notices.playerLeft(player.profile.nickname))
    else if (
      room.game?.drawerId === playerId &&
      (room.phase === 'choosing_word' ||
        (room.phase === 'paused' && room.game.phaseBeforePause === 'choosing_word'))
    )
      // 画家在选词阶段（包括该阶段处于暂停时）离开：本回合作废并直接进入下一回合选词。
      // 否则会落到下面的 finishRound，而它因 answer 尚未确定会静默 return，
      // 使房间卡在 paused 且 drawerId 指向已离开的玩家（恢复后进入无人能作画的空回合）。
      this.context.abandonChoosing(
        room,
        serverStrings.notices.drawerLeftChoosing(player.profile.nickname),
      )
    else if (
      room.game?.drawerId === playerId &&
      (room.phase === 'drawing' ||
        (room.phase === 'paused' && room.game.phaseBeforePause === 'drawing'))
    )
      this.context.finishRound(room, true) // 画家在作画阶段离开，本回合作废

    // 在线人数不足 2 人时自动暂停比赛
    if (
      this.onlineMemberCount(room) < APP_CONFIG.player.minPlayers &&
      this.context.isPlaying(room.phase)
    ) {
      this.context.pauseRoomInternal(room, serverStrings.notices.autoPaused)
    }
    this.context.emitRoom(room.id)
    this.context.broadcastPresence()
  }

  leaveGame(playerId: string): void {
    const { room, member, player } = this.requireMembership(playerId)
    if (room.phase === 'waiting' || room.phase === 'closed')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_LEAVE_GAME)
    if (member.spectating) {
      this.leaveRoom(playerId, serverStrings.notices.leaveReasonDefault)
      return
    }
    if (member.leftGame) return

    member.leftGame = true
    member.leftProfile = { ...player.profile }
    member.ready = false
    player.socket?.leave(room.id)
    delete player.roomId
    room.stateVersion += 1
    this.context.logger.info({ roomId: room.id, playerId }, '玩家主动退出当前对局并保留成绩卡')
    // 持久化：成员席位（leftGame/ready）与玩家房间归属同步入库。
    this.context.persistPlayer(player)
    this.context.persistRoom(room)

    const payload: MemberConnectionChange = {
      playerId,
      nickname: player.profile.nickname,
      connection: 'left',
    }
    this.context.emitRoomEvent(
      room.id,
      EVENTS.roomMemberConnectionChanged,
      createServerPush(payload),
    )

    if (room.hostId === playerId && !this.transferHostInternal(room)) {
      this.closeRoom(room, serverStrings.notices.closeRoomNoPlayableHost)
      return
    }

    if (room.phase === 'starting') {
      // 倒计时尚未正式开局：返回等待并移除离局占位，保留其他人的准备状态。
      room.members = room.members.filter((candidate) => !candidate.leftGame)
      this.context.setWaiting(room, serverStrings.notices.countdownCanceled, false)
      this.context.broadcastPresence()
      return
    }

    if (
      room.game?.drawerId === playerId &&
      (room.phase === 'choosing_word' ||
        (room.phase === 'paused' && room.game.phaseBeforePause === 'choosing_word'))
    )
      this.context.abandonChoosing(
        room,
        serverStrings.notices.drawerLeftChoosing(player.profile.nickname),
      )
    else if (
      room.game?.drawerId === playerId &&
      (room.phase === 'drawing' ||
        (room.phase === 'paused' && room.game.phaseBeforePause === 'drawing'))
    )
      this.context.finishRound(room, true)

    if (
      this.onlineMemberCount(room) < APP_CONFIG.player.minPlayers &&
      this.context.isPlaying(room.phase)
    )
      this.context.pauseRoomInternal(room, serverStrings.notices.autoPaused)
    this.context.emitRoom(room.id)
    this.context.broadcastPresence()
  }

  kick(playerId: string, targetId: string): void {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_KICK)
    if (targetId === playerId)
      throw new GameError('INVALID_TARGET', serverStrings.errors.INVALID_TARGET_SELF)
    if (!room.members.some((member) => member.playerId === targetId))
      throw new GameError('NOT_IN_ROOM', serverStrings.errors.NOT_IN_ROOM_KICK)
    // 先通知被踢玩家房间关闭，再走标准离开流程释放座位
    this.context.emitToPlayer(
      targetId,
      EVENTS.roomClosed,
      createServerPush({ reason: serverStrings.notices.kickedReason }),
    )
    this.leaveRoom(targetId, serverStrings.notices.kickedLog)
  }

  transferHost(playerId: string, targetId: string): void {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_TRANSFER_HOST)
    const targetMember = room.members.find((member) => member.playerId === targetId)
    if (!targetMember) throw new GameError('NOT_IN_ROOM', serverStrings.errors.NOT_IN_ROOM_TRANSFER)
    if (targetMember.spectating)
      throw new GameError('INVALID_TARGET', serverStrings.errors.SPECTATOR_CANNOT_HOST)
    room.hostId = targetId
    this.rotatePrivateJoinCode(room)
    room.stateVersion += 1
    this.context.addSystemNotice(
      room,
      serverStrings.notices.hostTransferred(
        this.context.players.get(targetId)?.profile.nickname ?? serverStrings.notices.hostFallback,
      ),
    )
    // 持久化：房主变更与轮换后的私密房码同步入库。
    this.context.persistRoom(room)
    this.context.emitRoom(room.id)
    // hostName 会显示在大厅房间行中，房主迁移后需同步广播大厅快照，避免列表展示陈旧房主名。
    this.context.broadcastPresence()
  }

  private closeRoom(room: RoomSecret, reason: string): void {
    // 清理全部计时器，广播关闭原因后从内存移除房间
    this.context.transition(room, 'closed')
    if (room.game) this.context.clearHintTimers(room.game)
    this.context.scheduler.clear(room.game?.timer)
    this.context.emitRoomEvent(room.id, EVENTS.roomClosed, createServerPush({ reason }))
    // 房间即将从内存删除：必须同时解绑幸存成员（含观战者）的 roomId 与 Socket 房间，
    // 否则 requireAvailablePlayer 会永久抛 ALREADY_IN_ROOM，玩家无法再建房/加入/被邀请。
    for (const member of room.members) {
      const player = this.context.players.get(member.playerId)
      if (!player) continue
      player.socket?.leave(room.id)
      if (player.roomId === room.id) {
        delete player.roomId
        // 同步持久化：房间关闭后清空仍在库玩家的房间归属（其身份仍保留，可回大厅）。
        this.context.persistPlayer(player)
      }
    }
    if (room.privateJoinCode) this.context.roomsByPrivateCode.delete(room.privateJoinCode)
    this.context.rooms.delete(room.id)
    // 持久化：删除房间及其成员记录（外键级联）。
    this.context.repositories.rooms.removeRoom(room.id)
    this.context.broadcastPresence()
  }

  private transferHostInternal(room: RoomSecret): boolean {
    // 房主离开/超时后把控制权迁移给第一个在线的可玩成员（观战者不能任房主），
    // 没有在线成员则取第一个非观战成员
    const candidate =
      room.members.find(
        (member) =>
          !member.spectating &&
          !member.leftGame &&
          this.context.players.get(member.playerId)?.connected,
      ) ?? room.members.find((member) => !member.spectating && !member.leftGame)
    if (!candidate) return false
    room.hostId = candidate.playerId
    this.rotatePrivateJoinCode(room)
    this.context.addSystemNotice(
      room,
      serverStrings.notices.hostMigrated(
        this.context.players.get(candidate.playerId)?.profile.nickname ??
          serverStrings.notices.hostFallback,
      ),
    )
    return true
  }

  private generatePrivateJoinCode(): string {
    const alphabet = APP_CONFIG.room.privateCodeAlphabet
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const code = Array.from({ length: APP_CONFIG.room.privateCodeLength }, () =>
        alphabet.charAt(this.context.random.integer(alphabet.length)),
      ).join('')
      if (!this.context.roomsByPrivateCode.has(code)) return code
    }
    // 极端碰撞时明确失败，不降级到 Math.random 或重复房间码。
    throw new GameError('PRIVATE_CODE_EXHAUSTED', serverStrings.errors.PRIVATE_CODE_EXHAUSTED)
  }

  private rotatePrivateJoinCode(room: RoomSecret): void {
    if (room.visibility !== 'private') return
    if (room.privateJoinCode) this.context.roomsByPrivateCode.delete(room.privateJoinCode)
    room.privateJoinCode = this.generatePrivateJoinCode()
    this.context.roomsByPrivateCode.set(room.privateJoinCode, room.id)
  }

  private createMember(player: PlayerSecret, room: RoomSecret, spectating = false): MemberState {
    // 玩家加入房间时创建初始席位状态（spectating=true 表示观战身份）
    const occupied = new Set(
      room.members.filter((member) => !member.leftGame).map((member) => member.seatIndex),
    )
    const seatIndex = APP_CONFIG.room.seatColors.findIndex((_color, index) => !occupied.has(index))
    if (seatIndex < 0) throw new GameError('ROOM_FULL', serverStrings.errors.ROOM_FULL)
    return {
      playerId: player.id,
      seatIndex,
      spectating,
      ready: false,
      score: 0,
      joinedAt: this.context.clock.now(),
      stats: { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 },
    }
  }

  public requireAvailablePlayer(playerId: string): PlayerSecret {
    const player = this.context.requirePlayer(playerId)
    if (player.roomId) throw new GameError('ALREADY_IN_ROOM', serverStrings.errors.ALREADY_IN_ROOM)
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
    if (!room || !member) throw new GameError('NOT_IN_ROOM', serverStrings.errors.NOT_IN_ROOM)
    return { player, room, member }
  }

  public requireHostRoom(playerId: string): RoomSecret {
    const { room } = this.requireMembership(playerId)
    if (room.hostId !== playerId) throw new GameError('FORBIDDEN', serverStrings.errors.FORBIDDEN)
    return room
  }

  public onlineMemberCount(room: RoomSecret): number {
    return room.members.filter(
      (member) =>
        !member.spectating &&
        !member.leftGame &&
        this.context.players.get(member.playerId)?.connected,
    ).length
  }
}
