import {
  EVENTS,
  ROOM_CLOSE_CODE,
  createServerPush,
  type MemberConnectionChange,
  type RoomCloseCode,
  type RoomPhase,
  type RoomSettings,
  type RoomSnapshot,
  type RoomVisibility,
  type ServerPushEnvelope,
  type ServerPushEventName,
} from '@draw-guess/shared'
import { APP_CONFIG } from '../../config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import { GameError, type RuntimeLogger } from '../../errors.ts'
import type { GameSecret, MemberState, PlayerSecret, RoomSecret } from '../../models.ts'
import { slidingWindowAllow } from '../../rate-limit.ts'
import type { PlayerLookupPorts, RoomEventPorts, RuntimePorts } from '../shared-ports.ts'
import type { VocabularyRegistry, VocabularyStore } from '../../vocabulary/index.ts'
import {
  countOnlinePlayers,
  createEmptyMemberStats,
  createOnlineLookup,
  isActivePlayer,
  isOnlinePlayer,
  nicknameOf,
  occupiesSeat,
  type OnlineLookup,
} from './member-facts.ts'
import { phaseEquivalent, reseatMembers } from './room-facts.ts'

/** 仅暴露本用例需要的数据与副作用端口；共享出口见 domain/shared-ports.ts，由应用层连接跨用例动作。 */
export interface RoomMembershipServiceContext
  extends RuntimePorts, RoomEventPorts, PlayerLookupPorts {
  abandonChoosing(room: RoomSecret, notice: string): void
  addSystemNotice(room: RoomSecret, text: string): void
  clearHintTimers(game: GameSecret): void
  /** 向单个玩家推送事件：事件名与信封编译期配对。 */
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
  pauseRoomInternal(room: RoomSecret, reason: string): void
  players: Map<string, PlayerSecret>
  rooms: Map<string, RoomSecret>
  roomsByPrivateCode: Map<string, string>
  setWaiting(room: RoomSecret, notice: string, resetReady?: boolean): void
  snapshot(room: RoomSecret, playerId: string): RoomSnapshot
  transition(room: RoomSecret, next: RoomPhase): void
  vocabulary: VocabularyRegistry
}

export class RoomMembershipService {
  /** 连通性查询：从成员事实单一口径构造（在构造函数体赋值，避开字段初始化早于参数属性的顺序）。 */
  private readonly isOnline: OnlineLookup

  constructor(private readonly context: RoomMembershipServiceContext) {
    this.isOnline = createOnlineLookup(this.context.players)
  }

  /** 断线代次与宽限期由会话用例校验；房主迁移只改变进程内房间状态。 */
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
      // presence 广播由会话侧（handleDisconnect 末尾）统一收尾，此处只推房间快照。
      { bumpVersion: true, emitRoom: true, broadcastPresence: false },
    )
  }
  createRoom(
    playerId: string,
    input: { name: string; visibility: RoomVisibility; settings: RoomSettings },
  ): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId) // 玩家必须不在其他房间
    // 规则范围由 RoomCreateSchema 内嵌的 RoomSettingsSchema 在绑定层裁决，服务端不再重校。
    const privateJoinCode =
      input.visibility === 'private' ? this.generatePrivateJoinCode() : undefined
    // 新房间默认选择词数最多的词库并全选其词条，成员只有房主一人，状态版本从 1 开始。
    const defaultPackageId = this.context.vocabulary.defaultPackageId
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

  joinRoom(playerId: string, roomId: string): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId)
    const room = this.context.rooms.get(roomId)
    if (!room || room.visibility !== 'public')
      throw new GameError('ROOM_NOT_FOUND', serverStrings.errors.ROOM_NOT_FOUND)
    return this.joinResolvedRoom(player, room, 'public')
  }

  joinPrivateRoom(playerId: string, code: string): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId)
    const attempt = slidingWindowAllow(
      player.privateJoinAttemptTimes,
      this.context.clock.now(),
      APP_CONFIG.room.privateJoinWindowMs,
      APP_CONFIG.room.privateJoinMaxAttempts,
    )
    // 与迁移前的原行为一致：无论拒绝与否都回写修剪后的队列（窗口随时间前滚，旧戳不滞留）。
    player.privateJoinAttemptTimes = attempt.times
    if (!attempt.allowed)
      throw new GameError('RATE_LIMITED', serverStrings.errors.RATE_LIMITED_PRIVATE_JOIN)
    const roomId = this.context.roomsByPrivateCode.get(code)
    const room = roomId ? this.context.rooms.get(roomId) : undefined
    if (!room || room.visibility !== 'private')
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
    // 容量按占席口径：仍保留的离局占位同样占席，故用 occupiesSeat 而非可玩口径。
    const occupyingMembers = room.members.filter(occupiesSeat)
    if (occupyingMembers.length >= room.settings.maxPlayers)
      throw new GameError('ROOM_FULL', serverStrings.errors.ROOM_FULL)
    const joiningInProgress = room.phase !== 'waiting'
    if (joiningInProgress) {
      if (room.settings.joinPolicy === 'forbid')
        throw new GameError('GAME_IN_PROGRESS', serverStrings.errors.GAME_IN_PROGRESS_FORBID)
      const waitingForNextGame = room.settings.joinPolicy === 'next_game'
      const member = this.createMember(player, room, true, waitingForNextGame)
      room.members.push(member)
      room.stateVersion += 1
      this.context.logger.info(
        { roomId: room.id, playerId: player.id, source },
        waitingForNextGame ? '玩家加入房间并等待下一局' : '玩家以观战身份加入房间',
      )
      player.roomId = room.id
      void player.socket?.join(room.id)
      this.context.emitRoom(room.id)
      this.context.broadcastPresence()
      return this.context.snapshot(room, player.id)
    }
    const member = this.createMember(player, room)
    room.members.push(member)
    room.stateVersion += 1
    this.context.logger.info({ roomId: room.id, playerId: player.id, source }, '玩家已加入房间')
    player.roomId = room.id
    void player.socket?.join(room.id)
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
    void player.socket?.leave(room.id)
    room.members = room.members.filter((member) => member.playerId !== playerId)
    if (room.phase === 'waiting') reseatMembers(room)
    this.context.logger.info({ roomId: room.id, playerId, reason }, '玩家已离开房间')
    delete player.roomId
    room.stateVersion += 1
    // 空房间直接关闭；房主离开先迁移/关闭；再按阶段收敛与统一广播（三段均为离场共用口径）。
    if (room.members.length === 0) {
      this.closeRoom(room, serverStrings.notices.closeRoomEmpty, ROOM_CLOSE_CODE.roomEmpty)
      return
    }
    if (this.reclaimHostOrClose(room, playerId)) return
    if (room.phase === 'starting')
      this.context.setWaiting(room, serverStrings.notices.countdownCanceled, false)
    else if (room.phase === 'waiting')
      this.context.addSystemNotice(room, serverStrings.notices.playerLeft(player.profile.nickname))
    else this.settleDrawerDeparture(room, playerId, player.profile.nickname)
    this.finalizeDepartureTail(room)
  }

  leaveGame(playerId: string): void {
    const { room, member, player } = this.requireMembership(playerId)
    if (room.phase === 'waiting')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_LEAVE_GAME)
    if (member.spectating) {
      this.leaveRoom(playerId, serverStrings.notices.leaveReasonDefault)
      return
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
      // 倒计时尚未正式开局：返回等待并移除离局占位，保留其他人的准备状态。
      // 与离房不同：退局不动其他人的席位与广播（维持原行为，仅刷在线 presence 后提前返回）。
      room.members = room.members.filter((candidate) => !candidate.leftGame)
      this.context.setWaiting(room, serverStrings.notices.countdownCanceled, false)
      this.context.broadcastPresence()
      return
    }

    // waiting 阶段已在用例入口拒绝，画家作废判定可直接进行
    this.settleDrawerDeparture(room, playerId, player.profile.nickname)
    this.finalizeDepartureTail(room)
  }

  /**
   * 离场共用①：离开的是房主则迁移控制权；迁移失败（无可承接成员）关闭房间。
   * 返回 true 表示房间已关闭，调用方立即结束收敛。
   */
  private reclaimHostOrClose(room: RoomSecret, playerId: string): boolean {
    if (room.hostId !== playerId || this.transferHostInternal(room)) return false
    this.closeRoom(
      room,
      serverStrings.notices.closeRoomNoPlayableHost,
      ROOM_CLOSE_CODE.noPlayableHost,
    )
    return true
  }

  /**
   * 离场共用②：画家缺席的阶段收敛。
   * 选词阶段（含该阶段处于暂停时）离开：本回合作废并直接进入下一回合选词——
   * 否则会落到 finishRound，而它因 answer 尚未确定会静默 return，
   * 使房间卡在 paused 且 drawerId 指向已离开的玩家（恢复后进入无人能作画的空回合）。
   * 作画阶段（含暂停前为作画）离开：本回合立即结算作废。
   */
  private settleDrawerDeparture(room: RoomSecret, playerId: string, nickname: string): void {
    if (room.game?.drawerId !== playerId) return
    if (phaseEquivalent(room, 'choosing_word'))
      this.context.abandonChoosing(room, serverStrings.notices.drawerLeftChoosing(nickname))
    else if (phaseEquivalent(room, 'drawing')) this.context.finishRound(room, true)
  }

  /**
   * 离场共用③：统一收尾——在线人数不足自动暂停、结算期重赛评估、全房间快照与在线在场广播。
   */
  private finalizeDepartureTail(room: RoomSecret): void {
    // 在线人数不足 2 人时自动暂停比赛
    if (
      countOnlinePlayers(room, this.isOnline) < APP_CONFIG.player.minPlayers &&
      this.context.isPlaying(room.phase)
    )
      this.context.pauseRoomInternal(room, serverStrings.notices.autoPaused)
    if (room.phase === 'game_result') this.context.evaluateRematch(room)
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
    // 先通知被踢玩家房间关闭，再走标准离开流程释放座位；用稳定关闭码而非文案表达语义
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

  transferHost(playerId: string, targetId: string): void {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_TRANSFER_HOST)
    const targetMember = room.members.find((member) => member.playerId === targetId)
    if (!targetMember) throw new GameError('NOT_IN_ROOM', serverStrings.errors.NOT_IN_ROOM_TRANSFER)
    if (targetMember.spectating)
      throw new GameError('INVALID_TARGET', serverStrings.errors.SPECTATOR_CANNOT_HOST)
    this.applyHostChange(
      room,
      targetId,
      serverStrings.notices.hostTransferred(
        nicknameOf(this.context.players, targetId, serverStrings.notices.hostFallback),
      ),
      // hostName 会显示在大厅房间行中，房主迁移后需同步广播大厅快照，避免列表展示陈旧房主名。
      { bumpVersion: true, emitRoom: true, broadcastPresence: true },
    )
  }

  private closeRoom(room: RoomSecret, reason: string, code: RoomCloseCode): void {
    // 清理全部计时器，广播关闭原因后从内存移除房间
    this.context.transition(room, 'closed')
    if (room.game) this.context.clearHintTimers(room.game)
    this.context.scheduler.clear(room.game?.timer)
    this.context.scheduler.clear(room.game?.rematchTimer)
    this.context.emitRoomEvent(
      room.id,
      EVENTS.roomClosed,
      createServerPush(EVENTS.roomClosed, { reason, code }),
    )
    // 房间即将从内存删除：必须同时解绑幸存成员（含观战者）的 roomId 与 Socket 房间，
    // 否则 requireAvailablePlayer 会永久抛 ALREADY_IN_ROOM，玩家无法再建房/加入/被邀请。
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
    // 优先在线可玩成员；都不在线时兜底取第一个可玩成员（观战者不能任房主）。
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
      // 版本号由调用方（leaveRoom）统一递增，快照与在线广播由离场收尾统一发出。
      { bumpVersion: false, emitRoom: false, broadcastPresence: false },
    )
    return true
  }

  /**
   * 房主变更单点：改 hostId、轮换私密房码，并按调用点声明的差异处理版本号 / 快照 / 广播。
   * 三处迁移路径（主动移交 / 断线兜底 / 离场兜底）此前各写一份实现，版本与广播归属
   * 全靠调用点约定；现在差异只在参数里显式声明。
   */
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
    // 极端碰撞时明确失败，不降级到 Math.random 或重复房间码。
    throw new GameError('PRIVATE_CODE_EXHAUSTED', serverStrings.errors.PRIVATE_CODE_EXHAUSTED)
  }

  private rotatePrivateJoinCode(room: RoomSecret): void {
    if (room.visibility !== 'private') return
    if (room.privateJoinCode) this.context.roomsByPrivateCode.delete(room.privateJoinCode)
    room.privateJoinCode = this.generatePrivateJoinCode()
    this.context.roomsByPrivateCode.set(room.privateJoinCode, room.id)
  }

  private createMember(
    player: PlayerSecret,
    room: RoomSecret,
    spectating = false,
    waitingForNextGame = false,
  ): MemberState {
    // 玩家加入房间时创建初始席位状态（spectating=true 表示观战身份）
    const occupied = new Set(room.members.filter(occupiesSeat).map((member) => member.seatIndex))
    const seatIndex = APP_CONFIG.room.seatColors.findIndex((_color, index) => !occupied.has(index))
    if (seatIndex < 0) throw new GameError('ROOM_FULL', serverStrings.errors.ROOM_FULL)
    return {
      playerId: player.id,
      seatIndex,
      spectating,
      waitingForNextGame,
      ready: false,
      score: 0,
      joinedAt: this.context.clock.now(),
      stats: createEmptyMemberStats(),
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
}
