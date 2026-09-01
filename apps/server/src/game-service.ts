/**
 * 服务端权威游戏服务。
 *
 * 本类独占所有可改变比赛结果的状态：身份、成员资格、准备、阶段、答案、计时、绘图与分数。
 * Socket 处理器只负责校验载荷并调用这些方法，客户端永远不能上传裁决结果。
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import type { Server, Socket } from 'socket.io'
import { APP_CONFIG, PUBLIC_CONFIG, type PublicConfig } from '../../../config.ts'
import { serverStrings } from '../../../config/strings.ts'
import {
  EVENTS,
  canTransition,
  isCloseAnswer,
  normalizeAnswer,
  normalizeHexColor,
  type ChatMessage,
  type FillCommand,
  type Invite,
  type PresenceSnapshot,
  type Profile,
  type PublicPlayer,
  type RoomPhase,
  type RoomSettings,
  type RoomVisibility,
  type RoomSnapshot,
  type Stroke,
  type VocabularySnapshot,
} from '@draw-guess/shared'
import type { GameSecret, InviteSecret, MemberState, PlayerSecret, RoomSecret } from './models.ts'
import { RoundMachine } from './round-machine.ts'
import { SnapshotBuilder } from './snapshot.ts'
import type { VocabularyStore } from './vocabulary.ts'
import { enforceEventRate } from './rate-limit.ts'
import { GameError, SILENT_LOGGER, type RuntimeLogger } from './errors.ts'

/** 默认房间规则只从根级配置生成，避免处理器中出现另一套默认值。 */
export function createDefaultRoomSettings(): RoomSettings {
  return {
    maxPlayers: APP_CONFIG.player.defaultMaxPlayers,
    roundsPerPlayer: APP_CONFIG.game.roundsPerPlayer.default,
    drawSeconds: APP_CONFIG.game.drawSeconds.default,
    chooseSeconds: APP_CONFIG.game.chooseSeconds.default,
    optionCount: APP_CONFIG.game.optionCount.default,
    showWordLength: APP_CONFIG.game.showWordLength,
    progressiveHints: APP_CONFIG.game.progressiveHints,
    closeGuessEnabled: APP_CONFIG.game.closeGuessEnabled,
    allowPlayerInvite: APP_CONFIG.room.allowPlayerInvite,
    allowPause: APP_CONFIG.room.allowPause,
    joinPolicy: APP_CONFIG.room.joinPolicy,
  }
}

/**
 * 计时器全部保存在房间秘密状态中。每次切换阶段前清理旧计时器，可阻止旧回调在新回合中误执行。
 */
export class GameService {
  readonly players = new Map<string, PlayerSecret>()
  readonly playersByToken = new Map<string, PlayerSecret>()
  readonly rooms = new Map<string, RoomSecret>()
  /** 私密房间码到内部 UUID 的内存索引；房间关闭后立即回收。 */
  readonly roomsByPrivateCode = new Map<string, string>()
  readonly invites = new Map<string, InviteSecret>()

  /** 回合流转状态机：开局/选词/作画/结算/暂停等阶段推进逻辑。 */
  readonly round = new RoundMachine(this)
  /** 视图裁剪（快照组装）构建器。 */
  readonly snapshotter = new SnapshotBuilder(this)

  constructor(
    /** @internal 内部协作接口 */
    readonly io: Server,
    readonly vocabulary: VocabularyStore,
    readonly logger: RuntimeLogger = SILENT_LOGGER,
  ) {}

  get publicConfig(): PublicConfig {
    return PUBLIC_CONFIG
  }

  /** 记录未预期的服务器内部错误（脱敏到错误名），供排查 bindRequest 兜底返回的 INTERNAL_ERROR。 */
  logUnexpectedError(error: unknown, context: Record<string, unknown> = {}): void {
    this.logger.error(
      {
        ...context,
        errorType: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      },
      '未预期的服务器内部错误',
    )
  }

  /** 注册新身份或使用服务端签发的临时令牌恢复原座位。 */
  register(
    socket: Socket,
    input: {
      protocolVersion: string
      profile: Profile
      preferences: { discoverable: boolean; acceptsInvites: boolean }
      recoveryToken?: string
    },
  ): { player: PublicPlayer; recoveryToken: string; restored: boolean } {
    // 协议版本不匹配时直接拒绝，避免新旧客户端互相干扰
    if (input.protocolVersion !== APP_CONFIG.app.protocolVersion) {
      throw new GameError('PROTOCOL_MISMATCH', serverStrings.errors.PROTOCOL_MISMATCH)
    }
    // 头像编号已由共享 Zod 白名单校验；服务层再次防御性确认，拒绝任意资源路径或 URL。
    if (!(APP_CONFIG.player.avatarIds as readonly string[]).includes(input.profile.avatarId))
      throw new GameError('INVALID_AVATAR_ID', serverStrings.errors.INVALID_AVATAR_ID)

    // 携带恢复令牌且仍处于宽限期内的玩家：复用原身份与座位（如仍在房间）
    const recovering = input.recoveryToken
      ? this.playersByToken.get(input.recoveryToken)
      : undefined
    if (
      recovering &&
      (!recovering.disconnectedAt ||
        Date.now() - recovering.disconnectedAt <= APP_CONFIG.network.reconnectGraceMs)
    ) {
      return this.reclaimPlayer(socket, recovering)
    }
    // 公开 playerId 绝不能用于恢复身份，否则大厅中的任意玩家都可据此接管他人座位。
    // 全新注册：生成随机昵称去重、UUID 身份、随机恢复令牌
    const nickname = this.makeUniqueNickname(this.cleanNickname(input.profile.nickname))
    const player: PlayerSecret = {
      id: randomUUID(),
      token: randomBytes(32).toString('base64url'),
      profile: { nickname, avatarId: input.profile.avatarId },
      preferences: input.preferences,
      socket,
      socketId: socket.id,
      connected: true,
      joinedAt: Date.now(),
      requestCache: new Map(),
      lastInviteAt: new Map(),
      guessEventTimes: [],
      drawEventTimes: [],
      privateJoinAttemptTimes: [],
    }
    socket.data.playerId = player.id
    this.players.set(player.id, player)
    this.playersByToken.set(player.token, player)
    this.logger.info({ playerId: player.id }, '玩家会话已注册')
    this.broadcastPresence()
    return {
      player: this.snapshotter.toPublicPlayer(player),
      recoveryToken: player.token,
      restored: false,
    }
  }

  /**
   * 把新连接接管到既有身份上（刷新/重连/多标签页接管旧 socket）。
   * 取消原清理定时器、断开旧连接、重新加入 Socket 房间并推送恢复快照。
   */
  private reclaimPlayer(
    socket: Socket,
    player: PlayerSecret,
  ): {
    player: PublicPlayer
    recoveryToken: string
    restored: boolean
  } {
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer)
    if (player.socket && player.socket.id !== socket.id) player.socket.disconnect(true)
    player.socket = socket
    player.socketId = socket.id
    player.connected = true
    delete player.disconnectedAt
    delete player.disconnectTimer
    socket.data.playerId = player.id
    // 恢复连接可能丢失过增量广播，强制下次快照对画布全量下发
    const room = player.roomId ? this.rooms.get(player.roomId) : undefined
    if (room) {
      const member = room.members.find((item) => item.playerId === player.id)
      if (member) member.lastSyncedSeq = undefined
    }
    this.joinSocketRoom(player) // 重新加入 Socket 房间，恢复广播接收
    this.emitRoom(player.roomId) // 重新推送房间快照，恢复对局视图
    this.broadcastPresence()
    return {
      player: this.snapshotter.toPublicPlayer(player),
      recoveryToken: player.token,
      restored: true,
    }
  }

  updateProfile(playerId: string, profile: Profile): PublicPlayer {
    const player = this.requirePlayer(playerId)
    // 房间内锁定资料，避免对局期间玩家频繁改名干扰其他成员辨识
    if (player.roomId) throw new GameError('PROFILE_LOCKED', serverStrings.errors.PROFILE_LOCKED)
    if (!(APP_CONFIG.player.avatarIds as readonly string[]).includes(profile.avatarId))
      throw new GameError('INVALID_AVATAR_ID', serverStrings.errors.INVALID_AVATAR_ID)
    // 改名后需要重新做唯一性校验（排除自己当前占用）
    player.profile = {
      nickname: this.makeUniqueNickname(this.cleanNickname(profile.nickname), player.id),
      avatarId: profile.avatarId,
    }
    this.broadcastPresence()
    return this.snapshotter.toPublicPlayer(player)
  }

  /** 更新发现/邀请偏好并广播大厅快照（影响是否出现在发现列表中）。 */
  updatePreferences(
    playerId: string,
    preferences: { discoverable: boolean; acceptsInvites: boolean },
  ): void {
    const player = this.requirePlayer(playerId)
    player.preferences = preferences
    this.broadcastPresence()
  }

  createRoom(
    playerId: string,
    input: { name: string; visibility: RoomVisibility; settings: RoomSettings },
  ): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId) // 玩家必须不在其他房间
    this.validateSettings(input.settings)
    const privateJoinCode =
      input.visibility === 'private' ? this.generatePrivateJoinCode() : undefined
    // 新房间默认全选词库，成员只有房主一人，状态版本从 1 开始。
    const room: RoomSecret = {
      id: randomUUID(),
      name: input.name.trim(),
      hostId: player.id,
      visibility: input.visibility,
      ...(privateJoinCode ? { privateJoinCode } : {}),
      phase: 'waiting',
      stateVersion: 1,
      settings: input.settings,
      members: [this.createMember(player)],
      selectedWordIds: new Set(this.vocabulary.items.map((word) => word.id)),
      createdAt: Date.now(),
    }
    this.rooms.set(room.id, room)
    if (privateJoinCode) this.roomsByPrivateCode.set(privateJoinCode, room.id)
    this.logger.info({ roomId: room.id, playerId, visibility: room.visibility }, '房间已创建')
    // 房主加入 Socket 房间并广播大厅更新
    player.roomId = room.id
    player.socket?.join(room.id)
    this.emitRoom(room.id)
    this.broadcastPresence()
    return this.snapshotter.snapshot(room, player.id)
  }

  /** 通过大厅内部 UUID 加入公开房；私密房 UUID 即使被猜到也按不存在处理。 */
  joinRoom(playerId: string, roomId: string): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId)
    const room = this.rooms.get(roomId)
    if (!room || room.phase === 'closed' || room.visibility !== 'public')
      throw new GameError('ROOM_NOT_FOUND', serverStrings.errors.ROOM_NOT_FOUND)
    return this.joinResolvedRoom(player, room, 'public')
  }

  /** 通过短码加入私密房；独立限频防止在局域网内高频枚举房间码。 */
  joinPrivateRoom(playerId: string, code: string): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId)
    const now = Date.now()
    player.privateJoinAttemptTimes = player.privateJoinAttemptTimes.filter(
      (timestamp) => now - timestamp < APP_CONFIG.room.privateJoinWindowMs,
    )
    if (player.privateJoinAttemptTimes.length >= APP_CONFIG.room.privateJoinMaxAttempts)
      throw new GameError('RATE_LIMITED', serverStrings.errors.RATE_LIMITED_PRIVATE_JOIN)
    player.privateJoinAttemptTimes.push(now)
    const roomId = this.roomsByPrivateCode.get(code)
    const room = roomId ? this.rooms.get(roomId) : undefined
    if (!room || room.phase === 'closed' || room.visibility !== 'private')
      throw new GameError('PRIVATE_ROOM_NOT_FOUND', serverStrings.errors.PRIVATE_ROOM_NOT_FOUND)
    player.privateJoinAttemptTimes = []
    return this.joinResolvedRoom(player, room, 'private-code')
  }

  /**
   * 已完成公开性或房间码授权后的统一加入流程。
   * 等待阶段按正式成员加入；游戏中仅 joinPolicy='spectate' 时允许观战加入。
   */
  private joinResolvedRoom(
    player: PlayerSecret,
    room: RoomSecret,
    source: 'public' | 'private-code' | 'invite',
  ): RoomSnapshot {
    if (room.members.length >= room.settings.maxPlayers)
      throw new GameError('ROOM_FULL', serverStrings.errors.ROOM_FULL)
    const spectating = room.phase !== 'waiting'
    if (spectating) {
      if (room.settings.joinPolicy === 'forbid')
        throw new GameError('GAME_IN_PROGRESS', serverStrings.errors.GAME_IN_PROGRESS_FORBID)
      if (room.settings.joinPolicy === 'next_game')
        throw new GameError('GAME_IN_PROGRESS', serverStrings.errors.GAME_IN_PROGRESS_NEXT)
      room.members.push(this.createMember(player, true))
      this.logger.info({ roomId: room.id, playerId: player.id, source }, '玩家以观战身份加入房间')
      player.roomId = room.id
      player.socket?.join(room.id)
      this.emitRoom(room.id)
      this.broadcastPresence()
      return this.snapshotter.snapshot(room, player.id)
    }
    room.members.push(this.createMember(player))
    this.logger.info({ roomId: room.id, playerId: player.id, source }, '玩家已加入房间')
    player.roomId = room.id
    player.socket?.join(room.id)
    // P3：仅当房间已存在其它非房主（可玩）成员时才重置全员准备，避免加入只有房主的空房时
    // 产生无意义的「所有人需要重新准备」提示；房主准备位本就为隐式就绪，无需重复确认。
    const hasPeerMembers = room.members.some(
      (member) =>
        member.playerId !== player.id && member.playerId !== room.hostId && !member.spectating,
    )
    if (hasPeerMembers)
      this.invalidateReady(room, serverStrings.notices.joinedReadyReset(player.profile.nickname))
    this.emitRoom(room.id)
    this.broadcastPresence()
    return this.snapshotter.snapshot(room, player.id)
  }

  leaveRoom(playerId: string, reason: string = serverStrings.notices.leaveReasonDefault): void {
    const player = this.requirePlayer(playerId)
    if (!player.roomId) {
      return
    }
    const room = this.rooms.get(player.roomId)
    if (!room) {
      delete player.roomId // 房间已不存在，仅清理玩家引用
      return
    }
    player.socket?.leave(room.id)
    room.members = room.members.filter((member) => member.playerId !== playerId)
    this.logger.info({ roomId: room.id, playerId, reason }, '玩家已离开房间')
    delete player.roomId
    room.stateVersion += 1

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
      this.round.setWaiting(room, serverStrings.notices.countdownCanceled)
    else if (room.phase === 'waiting')
      this.invalidateReady(room, serverStrings.notices.leaveReadyReset(reason))
    else if (room.phase === 'choosing_word' && room.game?.drawerId === playerId)
      // 画家在选词阶段离开：本回合作废，立即进入下一回合选词（避免回合挂起）
      this.round.abandonChoosing(
        room,
        serverStrings.notices.drawerLeftChoosing(player.profile.nickname),
      )
    else if (room.game?.drawerId === playerId) this.round.finishRound(room, true) // 画家离开，本回合作废

    // 在线人数不足 2 人时自动暂停比赛
    if (this.onlineMemberCount(room) < APP_CONFIG.player.minPlayers && this.isPlaying(room.phase)) {
      this.round.pauseRoomInternal(room, serverStrings.notices.autoPaused)
    }
    this.emitRoom(room.id)
    this.broadcastPresence()
  }

  /** 切换准备状态（仅等待阶段），并递增版本号通知全员；观战者不能准备。 */
  setReady(playerId: string, ready: boolean): RoomSnapshot {
    const { room, member } = this.requireMembership(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_READY)
    if (member.spectating)
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_SPECTATOR_READY)
    // 房主由服务端视为隐式准备；旧客户端误发准备请求时幂等返回，不污染状态版本。
    if (room.hostId === playerId || member.ready === ready)
      return this.snapshotter.snapshot(room, playerId)
    member.ready = ready
    room.stateVersion += 1
    this.emitRoom(room.id)
    return this.snapshotter.snapshot(room, playerId)
  }

  updateSettings(
    playerId: string,
    patch: Partial<RoomSettings>,
    expectedVersion: number,
  ): RoomSnapshot {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('SETTINGS_LOCKED', serverStrings.errors.SETTINGS_LOCKED_UPDATE)
    // 乐观并发控制：版本号不匹配说明有其他玩家改过规则，拒绝本次修改
    if (room.stateVersion !== expectedVersion)
      throw new GameError('VERSION_CONFLICT', serverStrings.errors.VERSION_CONFLICT_SETTINGS)
    const next = { ...room.settings, ...patch }
    this.validateSettings(next)
    // 最大人数不能小于当前坐席数，否则会出现超员
    if (next.maxPlayers < room.members.length)
      throw new GameError('INVALID_SETTINGS', serverStrings.errors.INVALID_SETTINGS_MAX_PLAYERS)
    room.settings = next
    this.invalidateReady(room, serverStrings.notices.rulesUpdated)
    this.emitRoom(room.id)
    this.broadcastPresence()
    return this.snapshotter.snapshot(room, playerId)
  }

  /** 房主读取本局词库快照（全部词条、当前选择与词库版本）。 */
  getVocabulary(playerId: string): VocabularySnapshot {
    const room = this.requireHostRoom(playerId)
    return {
      items: this.vocabulary.items,
      selectedIds: [...room.selectedWordIds],
      version: this.vocabulary.version,
    }
  }

  updateVocabulary(playerId: string, ids: string[], expectedVersion: number): VocabularySnapshot {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('SETTINGS_LOCKED', serverStrings.errors.SETTINGS_LOCKED_VOCABULARY)
    if (room.stateVersion !== expectedVersion)
      throw new GameError('VERSION_CONFLICT', serverStrings.errors.VERSION_CONFLICT_VOCABULARY)
    const selected = new Set(ids)
    // 词条数量不足时拒绝保存，保证开局选词阶段有足够候选
    if (selected.size < APP_CONFIG.vocabulary.minWords) {
      throw new GameError(
        'VOCABULARY_TOO_SMALL',
        serverStrings.errors.VOCABULARY_TOO_SMALL(APP_CONFIG.vocabulary.minWords),
      )
    }
    // 每个 ID 都必须来自权威词库，防止伪造词条注入
    for (const id of selected) {
      if (!this.vocabulary.byId.has(id))
        throw new GameError('INVALID_WORD_ID', serverStrings.errors.INVALID_WORD_ID)
    }
    room.selectedWordIds = selected
    this.invalidateReady(room, serverStrings.notices.vocabularyUpdated)
    this.emitRoom(room.id)
    return this.getVocabulary(playerId)
  }

  startGame(playerId: string, expectedVersion: number): RoomSnapshot {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_GAME_STARTED)
    if (room.stateVersion !== expectedVersion)
      throw new GameError('VERSION_CONFLICT', serverStrings.errors.VERSION_CONFLICT_START)
    // 开局硬性门槛：至少 2 名可玩成员且全部在线；只有非房主成员需要显式准备。
    const activeMembers = room.members.filter((member) => !member.spectating)
    if (activeMembers.length < APP_CONFIG.player.minPlayers)
      throw new GameError('NOT_ENOUGH_PLAYERS', serverStrings.errors.NOT_ENOUGH_PLAYERS)
    const allOnline = activeMembers.every((member) => this.players.get(member.playerId)?.connected)
    const guestsReady = activeMembers
      .filter((member) => member.playerId !== room.hostId)
      .every((member) => member.ready)
    if (!allOnline || !guestsReady)
      throw new GameError('NOT_ALL_READY', serverStrings.errors.NOT_ALL_READY)
    // 本局词条数必须不少于最小词数且覆盖选词候选数
    const requiredWords = Math.max(APP_CONFIG.vocabulary.minWords, room.settings.optionCount)
    if (room.selectedWordIds.size < requiredWords)
      throw new GameError(
        'VOCABULARY_TOO_SMALL',
        serverStrings.errors.VOCABULARY_TOO_SMALL_GAME(requiredWords),
      )

    // 进入 3 秒开始倒计时阶段；倒计时结束而且阶段未变时正式开局
    this.transition(room, 'starting')
    const gameId = randomUUID()
    const timer = setTimeout(() => {
      if (room.phase !== 'starting' || room.game?.id !== gameId) return
      this.round.beginGame(room)
    }, APP_CONFIG.game.startingCountdownSeconds * 1_000)
    // 预建本局秘密状态：洗牌确定画家顺序（只含可玩成员），清空所有历史与计时
    room.game = {
      id: gameId,
      roundId: '',
      phaseStartedAt: Date.now(),
      phaseEndsAt: Date.now() + APP_CONFIG.game.startingCountdownSeconds * 1_000,
      currentRound: 0,
      totalRounds: activeMembers.length * room.settings.roundsPerPlayer,
      drawerOrder: this.shuffle(activeMembers.map((member) => member.playerId)),
      drawerId: '',
      candidates: [],
      usedWordIds: new Set(),
      strokes: [],
      undoneStrokeIds: [],
      lastSequence: -1,
      messages: [],
      correctOrder: [],
      revealedIndices: new Set(),
      timer,
    }
    // 完整 game 已安装后只广播一次 starting 快照，避免客户端收到阶段存在但 game 缺失的中间态。
    this.emitRoom(room.id)
    return this.snapshotter.snapshot(room, playerId)
  }

  chooseWord(playerId: string, roundId: string, wordId: string): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    // 只有当前画家在同一回合的选词阶段可以选题
    if (room.phase !== 'choosing_word' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER_CHOOSE)
    }
    const answer = game.candidates.find((word) => word.id === wordId)
    if (!answer) throw new GameError('INVALID_WORD_ID', serverStrings.errors.INVALID_WORD_ID_CHOOSE)
    this.round.beginDrawing(room, answer)
  }

  submitGuess(
    playerId: string,
    roundId: string,
    rawText: string,
  ): { correct: boolean; close: boolean } {
    const { room, member } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    // 仅作画阶段可猜词，且必须在当前回合，且答案已确定；观战者不能猜词
    if (room.phase !== 'drawing' || game.roundId !== roundId || !game.answer)
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_GUESS)
    if (game.drawerId === playerId)
      throw new GameError('DRAWER_CANNOT_GUESS', serverStrings.errors.DRAWER_CANNOT_GUESS)
    if (member.spectating)
      throw new GameError('SPECTATOR_CANNOT_GUESS', serverStrings.errors.SPECTATOR_CANNOT_GUESS)
    if (member.guessedAt)
      throw new GameError('ALREADY_GUESSED', serverStrings.errors.ALREADY_GUESSED)
    const text = rawText.trim()
    enforceEventRate(this.requirePlayer(playerId), 'guess') // 猜词限频
    if (!text || Array.from(text).length > APP_CONFIG.player.chatMaxLength)
      throw new GameError('INVALID_MESSAGE', serverStrings.errors.INVALID_MESSAGE_EMPTY)
    const normalized = normalizeAnswer(text)
    const answer = normalizeAnswer(game.answer.text)
    // 命中正确答案：计分并广播，返回 correct 标记
    if (normalized === answer) {
      this.round.markCorrect(room, member)
      return { correct: true, close: false }
    }
    // 未命中但很接近：只提示原发送者，不进入聊天流，避免刷屏泄露
    const close = room.settings.closeGuessEnabled && isCloseAnswer(text, game.answer.text)
    if (close) {
      this.emitToPlayer(playerId, EVENTS.guessClose, { text: serverStrings.notices.guessClose })
    } else {
      this.addMessage(room, { type: 'guess', text, playerId })
    }
    this.emitRoom(room.id)
    return { correct: false, close }
  }

  sendPreset(playerId: string, roundId: string, preset: string): void {
    const { room, member } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    // 预设短语只能在作画阶段发送，且必须是配置白名单内的内容；观战者不能发送
    if (room.phase !== 'drawing' || game.roundId !== roundId)
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_PRESET)
    if (member.spectating)
      throw new GameError('SPECTATOR_CANNOT_CHAT', serverStrings.errors.SPECTATOR_CANNOT_CHAT)
    if (!(APP_CONFIG.presets.safeChat as readonly string[]).includes(preset))
      throw new GameError('INVALID_MESSAGE', serverStrings.errors.INVALID_MESSAGE_PRESET)
    this.addMessage(room, { type: 'preset', text: preset, playerId })
    this.emitRoom(room.id)
  }

  addStroke(playerId: string, roundId: string, stroke: Stroke): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    // 只有当前画家在作画阶段可以修改画板
    if (room.phase !== 'drawing' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER_ACTION)
    }
    enforceEventRate(this.requirePlayer(playerId), 'draw')
    // 序号必须严格递增，服务端拒绝迟到的旧包（网络乱序/重复发包）
    if (stroke.sequence <= game.lastSequence)
      throw new GameError('STALE_DRAW_EVENT', serverStrings.errors.STALE_DRAW_EVENT_STROKE)
    const color = normalizeHexColor(stroke.color)
    // 颜色与线宽均需合法，宽度超出范围也会被拒绝
    if (
      !color ||
      stroke.width < APP_CONFIG.drawing.width.min ||
      stroke.width > APP_CONFIG.drawing.width.max
    ) {
      throw new GameError('INVALID_DRAW_STYLE', serverStrings.errors.INVALID_DRAW_STYLE)
    }
    game.lastSequence = stroke.sequence
    // 同一笔画 ID 的后续批次会追加到已有笔画上，而不是新建命令
    const existing = game.strokes.find(
      (candidate): candidate is Stroke => candidate.kind === 'stroke' && candidate.id === stroke.id,
    )
    if (existing) {
      // 同一按下动作的后续批次沿用笔画 ID；只追加新增点，撤销仍能一次移除完整笔画。
      existing.points.push(...stroke.points)
      existing.sequence = stroke.sequence
    } else {
      game.strokes.push({ ...stroke, color, points: [...stroke.points] })
      // 历史命令超限时丢弃最早的命令，保护内存有界
      if (game.strokes.length > APP_CONFIG.drawing.maxHistoryCommands) game.strokes.shift()
    }
    game.undoneStrokeIds = [] // 新笔画会清空撤销栈（不能再撤销之前的操作）
    // E4：增量广播前标记房间全部成员已同步到该序号，快照可省略画布历史（差分下发）
    room.members.forEach((member) => (member.lastSyncedSeq = game.lastSequence))
    // 标准化颜色后广播给房间所有成员（画家自身也会收到并用于纠正本地预览）
    this.io.to(room.id).emit(EVENTS.drawStrokeBatch, { roundId, stroke: { ...stroke, color } })
  }

  /** 校验并提交封闭区域填充命令；客户端只上传点击位置和颜色，不上传像素数据。 */
  addFill(playerId: string, roundId: string, fill: FillCommand): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    // 只有当前画家在作画阶段可以执行填充
    if (room.phase !== 'drawing' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER_ACTION)
    }
    enforceEventRate(this.requirePlayer(playerId), 'draw')
    // 序号必须严格递增，拒绝旧包
    if (fill.sequence <= game.lastSequence)
      throw new GameError('STALE_DRAW_EVENT', serverStrings.errors.STALE_DRAW_EVENT_FILL)
    const color = normalizeHexColor(fill.color)
    if (!color) throw new GameError('INVALID_FILL', serverStrings.errors.INVALID_FILL)
    game.lastSequence = fill.sequence
    game.strokes.push({ ...fill, color })
    if (game.strokes.length > APP_CONFIG.drawing.maxHistoryCommands) game.strokes.shift()
    game.undoneStrokeIds = [] // 新填充同样清空撤销栈
    // E4：标记房间全部成员同步到该序号（与笔画增量同一套差分机制）
    room.members.forEach((member) => (member.lastSyncedSeq = game.lastSequence))
    this.io.to(room.id).emit(EVENTS.drawFillCommit, {
      roundId,
      fill: { ...fill, color },
    })
  }

  undo(playerId: string, roundId: string): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireDrawerGame(room, playerId, roundId)
    // 从最新命令倒序找第一条未撤销的命令，压入撤销栈（用 Set 加速去重判断，避免 O(n²)）
    const undoneSet = new Set(game.undoneStrokeIds)
    const target = [...game.strokes].reverse().find((stroke) => !undoneSet.has(stroke.id))
    if (target) game.undoneStrokeIds.push(target.id)
    this.emitRoom(room.id)
  }

  redo(playerId: string, roundId: string): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireDrawerGame(room, playerId, roundId)
    game.undoneStrokeIds.pop() // 撤销栈是先进后出，重做即弹出最后一条
    this.emitRoom(room.id)
  }

  clearDrawing(playerId: string, roundId: string): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireDrawerGame(room, playerId, roundId)
    game.strokes = []
    game.undoneStrokeIds = []
    game.lastSequence += 1 // 清空后跳号，保证后续命令仍大于历史序号
    this.emitRoom(room.id)
  }

  pause(playerId: string, reason: string): void {
    const { room, player } = this.requireMembership(playerId)
    if (!room.settings.allowPause)
      throw new GameError('PAUSE_DISABLED', serverStrings.errors.PAUSE_DISABLED)
    const safeReason = reason.trim().slice(0, 40) || serverStrings.notices.pauseFallbackReason
    // 普通玩家只能发出暂停请求（房主见通知），房主直接执行暂停
    if (room.hostId !== playerId) {
      this.addSystemNotice(
        room,
        serverStrings.notices.pauseRequest(player.profile.nickname, safeReason),
      )
      this.emitRoom(room.id)
      return
    }
    this.round.pauseRoomInternal(room, safeReason)
    this.emitRoom(room.id)
  }

  resume(playerId: string): void {
    const room = this.requireHostRoom(playerId)
    const game = this.requireGame(room)
    if (room.phase !== 'paused' || !game.phaseBeforePause)
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_RESUME)
    // 用暂停时冻结的剩余毫秒重建新的结束时间，继续原阶段
    const next = game.phaseBeforePause
    game.phaseStartedAt = Date.now()
    game.phaseEndsAt = Date.now() + (game.pausedRemainingMs ?? 1_000)
    delete game.phaseBeforePause
    delete game.pausedRemainingMs
    this.transition(room, next)
    this.round.scheduleCurrentPhase(room)
    this.emitRoom(room.id)
  }

  /** 房主提前结束比赛：仅对局进行中或暂停时可触发，直接进入最终结算。 */
  endEarly(playerId: string): void {
    const room = this.requireHostRoom(playerId)
    if (!this.isPlaying(room.phase) && room.phase !== 'paused')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_END_EARLY)
    this.round.finishGame(room, serverStrings.notices.endEarlyByHost)
  }

  /** 最终结算后返回等待阶段：释放本局秘密并让全员重新准备。 */
  returnWaiting(playerId: string): void {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'game_result')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_RETURN_WAITING)
    if (room.game?.timer) clearTimeout(room.game.timer)
    delete room.game
    room.phase = 'waiting'
    this.invalidateReady(room, serverStrings.notices.backToRoom)
    this.emitRoom(room.id)
    this.broadcastPresence()
  }

  kick(playerId: string, targetId: string): void {
    const room = this.requireHostRoom(playerId)
    if (targetId === playerId)
      throw new GameError('INVALID_TARGET', serverStrings.errors.INVALID_TARGET_SELF)
    if (!room.members.some((member) => member.playerId === targetId))
      throw new GameError('NOT_IN_ROOM', serverStrings.errors.NOT_IN_ROOM_KICK)
    // 先通知被踢玩家房间关闭，再走标准离开流程释放座位
    this.emitToPlayer(targetId, EVENTS.roomClosed, { reason: serverStrings.notices.kickedReason })
    this.leaveRoom(targetId, serverStrings.notices.kickedLog)
  }

  /** 房主主动移交控制权（仅等待阶段）：目标必须是房间成员。 */
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
    this.addSystemNotice(
      room,
      serverStrings.notices.hostTransferred(
        this.players.get(targetId)?.profile.nickname ?? serverStrings.notices.hostFallback,
      ),
    )
    this.emitRoom(room.id)
  }

  sendInvite(playerId: string, targetId: string): Invite {
    const { room } = this.requireMembership(playerId)
    const sender = this.requirePlayer(playerId)
    const target = this.requirePlayer(targetId)
    // 邀请前置条件：房间等待中且有席位；非房主邀请需开启 allowPlayerInvite
    if (room.phase !== 'waiting' || room.members.length >= room.settings.maxPlayers)
      throw new GameError('ROOM_NOT_JOINABLE', serverStrings.errors.ROOM_NOT_JOINABLE_INVITE)
    if (room.hostId !== playerId && !room.settings.allowPlayerInvite)
      throw new GameError('FORBIDDEN', serverStrings.errors.FORBIDDEN_INVITE)
    // 目标必须在线、不在房间且愿意接收邀请
    if (!target.connected || target.roomId || !target.preferences.acceptsInvites)
      throw new GameError('TARGET_UNAVAILABLE', serverStrings.errors.TARGET_UNAVAILABLE)
    // 同一目标有冷却时间，防止反复骚扰
    const last = sender.lastInviteAt.get(targetId) ?? 0
    if (Date.now() - last < APP_CONFIG.network.inviteCooldownMs)
      throw new GameError('RATE_LIMITED', serverStrings.errors.RATE_LIMITED_INVITE)
    sender.lastInviteAt.set(targetId, Date.now())
    // 创建 30 秒有效的邀请，超时自动回收
    const id = randomUUID()
    const expiresAt = Date.now() + APP_CONFIG.network.inviteExpiryMs
    const invite: InviteSecret = {
      id,
      fromPlayerId: playerId,
      toPlayerId: targetId,
      roomId: room.id,
      expiresAt,
      timer: setTimeout(() => this.resolveInvite(id, 'expired'), APP_CONFIG.network.inviteExpiryMs),
    }
    this.invites.set(id, invite)
    const publicInvite = this.snapshotter.toPublicInvite(invite)
    target.socket?.emit(EVENTS.inviteReceived, publicInvite)
    return publicInvite
  }

  respondInvite(playerId: string, inviteId: string, accept: boolean): RoomSnapshot | undefined {
    const invite = this.invites.get(inviteId)
    // 只允许被邀请者本人应答，且邀请未过期
    if (!invite || invite.toPlayerId !== playerId || invite.expiresAt < Date.now())
      throw new GameError('INVITE_EXPIRED', serverStrings.errors.INVITE_EXPIRED)
    const room = this.rooms.get(invite.roomId)
    this.resolveInvite(inviteId, accept ? 'accepted' : 'declined')
    if (!accept) return undefined
    if (!room) throw new GameError('ROOM_NOT_FOUND', serverStrings.errors.ROOM_NOT_FOUND_INVITE)
    // 定向邀请本身就是授权凭据，可加入公开或私密房，但仍需通过统一容量/阶段校验。
    const player = this.requireAvailablePlayer(playerId)
    return this.joinResolvedRoom(player, room, 'invite')
  }

  handleDisconnect(socket: Socket): void {
    const playerId = socket.data.playerId as string | undefined
    if (!playerId) return
    // 只处理当前连接对应的身份，防止旧 socket 断开误伤新连接
    const player = this.players.get(playerId)
    if (!player || player.socketId !== socket.id) return
    player.connected = false
    this.logger.info({ playerId, roomId: player.roomId }, '玩家连接已断开并进入恢复宽限')
    player.socket = undefined
    player.socketId = undefined
    player.disconnectedAt = Date.now()
    // E4：断线期间可能丢失增量广播，重连后强制全量同步画布
    if (player.roomId) {
      const playerRoom = this.rooms.get(player.roomId)
      const member = playerRoom?.members.find((item) => item.playerId === playerId)
      if (member) member.lastSyncedSeq = undefined
    }
    const room = player.roomId ? this.rooms.get(player.roomId) : undefined
    // 倒计时中掉线则取消开局
    if (room?.phase === 'starting')
      this.round.setWaiting(room, serverStrings.notices.disconnectCountdownCanceled)
    // 画家在作画阶段掉线：给予画家级宽限期，超时未回则当前回合作废
    if (room?.game?.drawerId === playerId && room.phase === 'drawing') {
      setTimeout(() => {
        if (
          !player.connected &&
          player.roomId === room.id &&
          room.game?.drawerId === playerId &&
          room.phase === 'drawing'
        )
          this.round.finishRound(room, true)
      }, APP_CONFIG.network.drawerReconnectGraceMs)
    }
    // 画家在选词阶段掉线：同样给予画家级宽限期，超时未回则作废本回合并重选
    else if (room?.game?.drawerId === playerId && room.phase === 'choosing_word') {
      setTimeout(() => {
        if (
          !player.connected &&
          player.roomId === room.id &&
          room.game?.drawerId === playerId &&
          room.phase === 'choosing_word'
        )
          this.round.abandonChoosing(room, serverStrings.notices.drawerDisconnectChoosing)
      }, APP_CONFIG.network.drawerReconnectGraceMs)
    }
    // 房主短暂断线期间保留身份；超过画家级宽限仍未恢复时迁移控制权，避免比赛无人可继续。
    if (room?.hostId === playerId) {
      setTimeout(() => {
        if (
          !player.connected &&
          player.roomId === room.id &&
          room.hostId === playerId &&
          room.members.length > 1
        ) {
          const previousHost = room.members.find((member) => member.playerId === playerId)
          // 优先把控制权交给仍在线的可玩成员（观战者不能任房主）
          const candidate = room.members.find(
            (member) =>
              member.playerId !== playerId &&
              !member.spectating &&
              this.players.get(member.playerId)?.connected,
          )
          if (candidate) {
            room.hostId = candidate.playerId
            this.rotatePrivateJoinCode(room)
            if (previousHost) room.stateVersion += 1
            this.addSystemNotice(
              room,
              serverStrings.notices.hostMigratedTimeout(
                this.players.get(candidate.playerId)?.profile.nickname ??
                  serverStrings.notices.hostFallback,
              ),
            )
            this.emitRoom(room.id)
          }
        }
      }, APP_CONFIG.network.drawerReconnectGraceMs)
    }
    // 常规玩家级宽限期结束后释放身份（座位与关系），跟房主/画家宽限并行计时
    player.disconnectTimer = setTimeout(
      () => this.expireDisconnectedPlayer(playerId),
      APP_CONFIG.network.reconnectGraceMs,
    )
    this.emitRoom(player.roomId)
    this.broadcastPresence()
  }

  /**
   * 向房间所有成员推送各自的角色裁剪快照。
   * 每个成员看到的答案/候选词不同，因此必须以成员为观看者分别生成。
   */
  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public emitRoom(roomId?: string): void {
    if (!roomId) return
    const room = this.rooms.get(roomId)
    if (!room) return
    for (const member of room.members) {
      const player = this.players.get(member.playerId)
      player?.socket?.emit(EVENTS.roomSnapshot, this.snapshotter.snapshot(room, member.playerId))
    }
  }

  /**
   * 在线玩家与公开房间列表同源广播；独立 room:listChanged 事件让大厅可明确订阅房间变化，
   * presence:snapshot 则继续承担初始全量同步和向后兼容。
   */
  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public broadcastPresence(): void {
    const snapshot = this.presenceSnapshot()
    this.io.emit(EVENTS.presenceSnapshot, snapshot)
    this.io.emit(EVENTS.roomListChanged, snapshot.rooms)
  }

  /** 大厅在线状态快照：只包含可发现玩家与全部未关闭房间。 */ /** 大厅在线状态快照：只包含可发现玩家与全部未关闭房间。 */
  presenceSnapshot(): PresenceSnapshot {
    return {
      players: [...this.players.values()]
        .filter((player) => player.preferences.discoverable)
        .map((player) => this.snapshotter.toPublicPlayer(player)),
      rooms: [...this.rooms.values()]
        .filter((room) => room.phase !== 'closed' && room.visibility === 'public')
        .map((room) => this.snapshotter.toPublicRoom(room)),
    }
  }

  /** 取指定玩家的当前房间快照（用于断线恢复/重同步），不要求玩家在线。 */
  snapshotForPlayer(playerId: string, forceFull = false): RoomSnapshot | undefined {
    const player = this.players.get(playerId)
    const room = player?.roomId ? this.rooms.get(player.roomId) : undefined
    if (!room) return undefined
    // 全量模式：清除差分游标，让快照携带完整画布历史（客户端本地落后/丢包后的修复通道）
    if (forceFull) {
      const member = room.members.find((item) => item.playerId === playerId)
      if (member) member.lastSyncedSeq = undefined
    }
    return this.snapshotter.snapshot(room, playerId)
  }

  /**
   * 画家在选词阶段离开/掉线时废弃当前回合，立即进入下一回合选词。
   * 先把阶段切到 round_result（从 choosing_word 出发的合法转换），再走统一的开局流程，
   * 避免选词计时器空转导致整轮挂起。
   */

  /** 执行合法的阶段转换；非法转换直接抛错，绝不自作主张切换。转换后版本号 +1。 */
  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public transition(room: RoomSecret, next: RoomPhase): void {
    if (!canTransition(room.phase, next))
      throw new GameError(
        'INVALID_TRANSITION',
        serverStrings.errors.INVALID_TRANSITION(room.phase, next),
      )
    const previous = room.phase
    room.phase = next
    this.logger.info({ roomId: room.id, from: previous, to: next }, '房间阶段已转换')
    room.stateVersion += 1
  }

  /**
   * 为指定观看者生成裁剪后的房间快照。
   * 画家能看到答案与候选词；猜词者只能看到遮罩；结算阶段全员都能看到答案。
   */

  private resolveInvite(id: string, status: 'accepted' | 'declined' | 'expired'): void {
    // 无论接受/拒绝/过期，都清除定时器并通知邀请双方
    const invite = this.invites.get(id)
    if (!invite) return
    clearTimeout(invite.timer)
    this.invites.delete(id)
    const payload = { id, status }
    this.emitToPlayer(invite.fromPlayerId, EVENTS.inviteResolved, payload)
    this.emitToPlayer(invite.toPlayerId, EVENTS.inviteResolved, payload)
  }

  private expireDisconnectedPlayer(playerId: string): void {
    // 恢复宽限期结束仍断线：离开房间并删除身份
    const player = this.players.get(playerId)
    if (!player || player.connected) return
    if (player.roomId) this.leaveRoom(playerId, serverStrings.notices.playerReconnectedTimeout)
    this.players.delete(player.id)
    this.playersByToken.delete(player.token)
    this.broadcastPresence()
  }

  private closeRoom(room: RoomSecret, reason: string): void {
    // 清理全部计时器，广播关闭原因后从内存移除房间
    if (room.game) this.clearHintTimers(room.game)
    if (room.game?.timer) clearTimeout(room.game.timer)
    room.phase = 'closed'
    this.io.to(room.id).emit(EVENTS.roomClosed, { reason })
    if (room.privateJoinCode) this.roomsByPrivateCode.delete(room.privateJoinCode)
    this.rooms.delete(room.id)
    this.broadcastPresence()
  }

  private transferHostInternal(room: RoomSecret): boolean {
    // 房主离开/超时后把控制权迁移给第一个在线的可玩成员（观战者不能任房主），
    // 没有在线成员则取第一个非观战成员
    const candidate =
      room.members.find(
        (member) => !member.spectating && this.players.get(member.playerId)?.connected,
      ) ?? room.members.find((member) => !member.spectating)
    if (!candidate) return false
    room.hostId = candidate.playerId
    this.rotatePrivateJoinCode(room)
    this.addSystemNotice(
      room,
      serverStrings.notices.hostMigrated(
        this.players.get(candidate.playerId)?.profile.nickname ??
          serverStrings.notices.hostFallback,
      ),
    )
    return true
  }

  /** @internal 内部协作接口 */
  public invalidateReady(room: RoomSecret, notice: string): void {
    // 成员变化/规则变化后全员取消准备并广播通知
    room.members.forEach((member) => (member.ready = false))
    room.stateVersion += 1
    this.addSystemNotice(room, notice)
  }

  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public addMessage(room: RoomSecret, input: Omit<ChatMessage, 'id' | 'createdAt'>): void {
    const game = this.requireGame(room)
    game.messages.push({ ...input, id: randomUUID(), createdAt: Date.now() })
    // 消息只保留最近两倍展示数量，防止内存无限增长
    game.messages = game.messages.slice(-APP_CONFIG.ui.recentMessageCount * 2)
  }

  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public addSystemNotice(room: RoomSecret, text: string): void {
    // 系统通知同时进入消息历史和作为独立事件推送（即使尚无对局也能收到）
    if (room.game) this.addMessage(room, { type: 'system', text })
    this.io.to(room.id).emit(EVENTS.systemNotice, { text })
  }

  /**
   * 按剩余时间阈值安排提示。
   * 剩余比例降到某个阈值以下时揭示一个非标点字符（如 [0.35, 0.2] 表示两次揭示），
   * 且每次揭示后仍保留至少一个字符未知，因此提示只缩小范围而不会直接泄露答案。
   */

  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public clearHintTimers(game: GameSecret): void {
    // 清理全部逐步提示计时器，防止暂停/切换阶段后旧回调误触发
    for (const timer of game.hintTimers ?? []) clearTimeout(timer)
    game.hintTimers = []
  }

  /** @internal 内部协作接口 */
  public pickCandidates(room: RoomSecret, game: GameSecret) {
    // 从本局已选词库中排除本局已用过的词条，构建候选池
    let pool = [...room.selectedWordIds]
      .filter((id) => !game.usedWordIds.has(id))
      .map((id) => this.vocabulary.byId.get(id))
      .filter((word) => word !== undefined)
    // 词池不足且配置允许时重置已用记录，保证每回合候选充足
    if (pool.length < room.settings.optionCount && APP_CONFIG.vocabulary.resetWhenExhausted) {
      game.usedWordIds.clear()
      pool = [...room.selectedWordIds]
        .map((id) => this.vocabulary.byId.get(id))
        .filter((word) => word !== undefined)
    }
    // 洗牌后截取前 optionCount 个作为本轮候选项
    return this.shuffle(pool).slice(0, room.settings.optionCount)
  }

  /** @internal 内部协作接口 */
  public findNextDrawer(room: RoomSecret, game: GameSecret): string | undefined {
    // 从当前回合序号起，按开局洗牌顺序寻找第一位仍在房间、在线的可玩成员任画家（观战者跳过）
    const start = game.currentRound - 1
    for (let offset = 0; offset < game.drawerOrder.length; offset += 1) {
      const candidate = game.drawerOrder[(start + offset) % game.drawerOrder.length]
      const member = room.members.find((item) => item.playerId === candidate)
      if (candidate && member && !member.spectating && this.players.get(candidate)?.connected)
        return candidate
    }
    return undefined
  }

  /** 使用密码学安全随机数生成进程内唯一的私密房间码。 */
  private generatePrivateJoinCode(): string {
    const alphabet = APP_CONFIG.room.privateCodeAlphabet
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const code = Array.from({ length: APP_CONFIG.room.privateCodeLength }, () =>
        alphabet.charAt(randomInt(alphabet.length)),
      ).join('')
      if (!this.roomsByPrivateCode.has(code)) return code
    }
    // 极端碰撞时明确失败，不降级到 Math.random 或重复房间码。
    throw new GameError('PRIVATE_CODE_EXHAUSTED', serverStrings.errors.UNKNOWN_FAILURE)
  }

  /** 房主迁移后轮换私密码，防止旧房主继续分享旧访问凭据。 */
  private rotatePrivateJoinCode(room: RoomSecret): void {
    if (room.visibility !== 'private') return
    if (room.privateJoinCode) this.roomsByPrivateCode.delete(room.privateJoinCode)
    room.privateJoinCode = this.generatePrivateJoinCode()
    this.roomsByPrivateCode.set(room.privateJoinCode, room.id)
  }

  private createMember(player: PlayerSecret, spectating = false): MemberState {
    // 玩家加入房间时创建初始席位状态（spectating=true 表示观战身份）
    return {
      playerId: player.id,
      spectating,
      ready: false,
      score: 0,
      joinedAt: Date.now(),
      stats: { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 },
    }
  }

  private cleanNickname(value: string): string {
    // 剔除控制字符（换行、零宽字符等），防止昵称破坏聊天排版
    const clean = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
    // 按可见字符（Unicode 码点）计数校验长度
    if (
      Array.from(clean).length < APP_CONFIG.player.nicknameMinLength ||
      Array.from(clean).length > APP_CONFIG.player.nicknameMaxLength
    ) {
      throw new GameError(
        'INVALID_NICKNAME',
        serverStrings.errors.INVALID_NICKNAME(
          APP_CONFIG.player.nicknameMinLength,
          APP_CONFIG.player.nicknameMaxLength,
        ),
      )
    }
    return clean
  }

  private makeUniqueNickname(value: string, exceptId?: string): string {
    // 收集当前全部玩家的昵称（排除自己），用于重名检测
    const occupied = new Set(
      [...this.players.values()]
        .filter((player) => player.id !== exceptId)
        .map((player) => normalizeAnswer(player.profile.nickname)),
    )
    if (!occupied.has(normalizeAnswer(value))) return value
    // 重名时追加数字后缀（2～99），且保证裁剪后不超出昵称长度上限
    for (let suffix = 2; suffix <= 99; suffix += 1) {
      const base = Array.from(value)
        .slice(0, APP_CONFIG.player.nicknameMaxLength - String(suffix).length)
        .join('')
      const candidate = `${base}${suffix}`
      if (!occupied.has(normalizeAnswer(candidate))) return candidate
    }
    throw new GameError('DUPLICATE_NICKNAME', serverStrings.errors.DUPLICATE_NICKNAME)
  }

  private validateSettings(settings: RoomSettings): void {
    const valid =
      Number.isInteger(settings.maxPlayers) &&
      settings.maxPlayers >= APP_CONFIG.player.minPlayers &&
      settings.maxPlayers <= APP_CONFIG.player.maxPlayers &&
      settings.roundsPerPlayer >= APP_CONFIG.game.roundsPerPlayer.min &&
      settings.roundsPerPlayer <= APP_CONFIG.game.roundsPerPlayer.max &&
      settings.drawSeconds >= APP_CONFIG.game.drawSeconds.min &&
      settings.drawSeconds <= APP_CONFIG.game.drawSeconds.max &&
      settings.chooseSeconds >= APP_CONFIG.game.chooseSeconds.min &&
      settings.chooseSeconds <= APP_CONFIG.game.chooseSeconds.max &&
      settings.optionCount >= APP_CONFIG.game.optionCount.min &&
      settings.optionCount <= APP_CONFIG.game.optionCount.max
    if (!valid) throw new GameError('INVALID_SETTINGS', serverStrings.errors.INVALID_SETTINGS)
  }

  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public requirePlayer(playerId: string): PlayerSecret {
    const player = this.players.get(playerId)
    if (!player) throw new GameError('UNAUTHORIZED', serverStrings.errors.UNAUTHORIZED)
    return player
  }

  /** 取身份并要求玩家当前不在任何房间（用于建房间/加入房间）。 */
  private requireAvailablePlayer(playerId: string): PlayerSecret {
    const player = this.requirePlayer(playerId)
    if (player.roomId) throw new GameError('ALREADY_IN_ROOM', serverStrings.errors.ALREADY_IN_ROOM)
    return player
  }

  /** 取身份 + 房间 + 成员席位三合一；不在房间时抛 NOT_IN_ROOM。 */
  private requireMembership(playerId: string): {
    player: PlayerSecret
    room: RoomSecret
    member: MemberState
  } {
    const player = this.requirePlayer(playerId)
    const room = player.roomId ? this.rooms.get(player.roomId) : undefined
    const member = room?.members.find((candidate) => candidate.playerId === playerId)
    if (!room || !member) throw new GameError('NOT_IN_ROOM', serverStrings.errors.NOT_IN_ROOM)
    return { player, room, member }
  }

  /** 取房间并要求调用者为房主，否则抛 FORBIDDEN。 */
  private requireHostRoom(playerId: string): RoomSecret {
    const { room } = this.requireMembership(playerId)
    if (room.hostId !== playerId) throw new GameError('FORBIDDEN', serverStrings.errors.FORBIDDEN)
    return room
  }

  /** 取对局秘密，房间没有进行中的游戏时抛 NO_GAME。 */
  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public requireGame(room: RoomSecret): GameSecret {
    if (!room.game) throw new GameError('NO_GAME', serverStrings.errors.NO_GAME)
    return room.game
  }

  /** 取对局并要求调用者是当前回合画家（绘图权限守卫）。 */
  private requireDrawerGame(room: RoomSecret, playerId: string, roundId: string): GameSecret {
    const game = this.requireGame(room)
    if (room.phase !== 'drawing' || game.drawerId !== playerId || game.roundId !== roundId)
      throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER)
    return game
  }

  /** 统计房间内当前在线的可玩成员数（排除观战者与断线宽限期玩家）。 */
  private onlineMemberCount(room: RoomSecret): number {
    return room.members.filter(
      (member) => !member.spectating && this.players.get(member.playerId)?.connected,
    ).length
  }

  /** 是否为对局中的阶段（可用于暂停判定）。 */
  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public isPlaying(phase: RoomPhase): boolean {
    return ['starting', 'choosing_word', 'drawing', 'round_result'].includes(phase)
  }

  /** 玩家恢复连接后重新加入其所属的 Socket 房间。 */
  private joinSocketRoom(player: PlayerSecret): void {
    if (player.roomId) player.socket?.join(player.roomId)
  }

  /** 向指定玩家发送无 ack 的推送事件。 */
  private emitToPlayer(playerId: string, event: string, payload: unknown): void {
    this.players.get(playerId)?.socket?.emit(event, payload)
  }

  /** Fisher-Yates 洗牌：随机打乱数组并返回新数组（不改原数组）。 */
  private shuffle<T>(values: T[]): T[] {
    const result = [...values]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1))
      ;[result[index], result[target]] = [result[target] as T, result[index] as T]
    }
    return result
  }
}
