/**
 * 服务端权威游戏服务。
 *
 * 本类独占所有可改变比赛结果的状态：身份、成员资格、准备、阶段、答案、计时、绘图与分数。
 * Socket 处理器只负责校验载荷并调用这些方法，客户端永远不能上传裁决结果。
 */
import { randomBytes, randomUUID } from 'node:crypto'
import type { Server, Socket } from 'socket.io'
import { APP_CONFIG, PUBLIC_CONFIG, type PublicConfig } from '../../../config.ts'
import {
  EVENTS,
  calculateGuessScore,
  canTransition,
  createAnswerMask,
  isCloseAnswer,
  normalizeAnswer,
  normalizeHexColor,
  type Ack,
  type ChatMessage,
  type FillCommand,
  type GameView,
  type Invite,
  type PresenceSnapshot,
  type PublicPlayer,
  type PublicRoom,
  type RoomPhase,
  type RoomSettings,
  type RoomSnapshot,
  type RoundResult,
  type Stroke,
  type VocabularySnapshot,
} from '@draw-guess/shared'
import type { GameSecret, InviteSecret, MemberState, PlayerSecret, RoomSecret } from './models.ts'
import type { VocabularyStore } from './vocabulary.ts'

/** 运行日志只接受脱敏结构化上下文；生产入口注入 Pino，未注入时保持静默。 */
export interface RuntimeLogger {
  info(context: Record<string, unknown>, message: string): void
  error(context: Record<string, unknown>, message: string): void
}

const SILENT_LOGGER: RuntimeLogger = { info: () => undefined, error: () => undefined }

export class GameError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** 创建请求成功回应，保证 requestId 原样返回供客户端核对。 */
export function success<T>(data: T, requestId: string): Ack<T> {
  return { ok: true, data, requestId }
}

/** 创建不泄露内部堆栈的失败回应。 */
export function failure(error: unknown, requestId: string): Ack<never> {
  return {
    ok: false,
    error: {
      code: error instanceof GameError ? error.code : 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : '服务暂时不可用，请稍后重试',
    },
    requestId,
  }
}

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
  readonly invites = new Map<string, InviteSecret>()

  constructor(
    private readonly io: Server,
    readonly vocabulary: VocabularyStore,
    private readonly logger: RuntimeLogger = SILENT_LOGGER,
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
      profile: { nickname: string; avatarColor: string }
      preferences: { discoverable: boolean; acceptsInvites: boolean }
      recoveryToken?: string
    },
  ): { player: PublicPlayer; recoveryToken: string; restored: boolean } {
    // 协议版本不匹配时直接拒绝，避免新旧客户端互相干扰
    if (input.protocolVersion !== APP_CONFIG.app.protocolVersion) {
      throw new GameError('PROTOCOL_MISMATCH', '客户端版本与服务器不兼容，请刷新或更新页面')
    }
    // 头像色必须是规范 #RRGGBB，统一大写后存储与服务端比较
    const avatarColor = normalizeHexColor(input.profile.avatarColor)
    if (!avatarColor) throw new GameError('INVALID_AVATAR_COLOR', '头像颜色格式无效，请重新选择')

    // 携带恢复令牌且仍处于宽限期内的玩家：复用原身份与座位（如仍在房间）
    const recovering = input.recoveryToken
      ? this.playersByToken.get(input.recoveryToken)
      : undefined
    if (
      recovering &&
      (!recovering.disconnectedAt ||
        Date.now() - recovering.disconnectedAt <= APP_CONFIG.network.reconnectGraceMs)
    ) {
      // 取消原清理定时器，断开旧 socket（若有），把新连接挂到原身份上
      if (recovering.disconnectTimer) clearTimeout(recovering.disconnectTimer)
      recovering.socket?.disconnect(true)
      recovering.socket = socket
      recovering.socketId = socket.id
      recovering.connected = true
      delete recovering.disconnectedAt
      delete recovering.disconnectTimer
      socket.data.playerId = recovering.id
      // E4：恢复连接的客户端可能丢失过增量广播，强制其下次快照全量下发画布
      const recoveringRoom = recovering.roomId ? this.rooms.get(recovering.roomId) : undefined
      if (recoveringRoom) {
        const member = recoveringRoom.members.find((item) => item.playerId === recovering.id)
        if (member) member.lastSyncedSeq = undefined
      }
      this.joinSocketRoom(recovering) // 重新加入 Socket 房间，恢复广播接收
      this.emitRoom(recovering.roomId) // 重新推送房间快照，恢复对局视图
      this.broadcastPresence()
      return {
        player: this.toPublicPlayer(recovering),
        recoveryToken: recovering.token,
        restored: true,
      }
    }

    // 全新注册：生成随机昵称去重、UUID 身份、随机恢复令牌
    const nickname = this.makeUniqueNickname(this.cleanNickname(input.profile.nickname))
    const player: PlayerSecret = {
      id: randomUUID(),
      token: randomBytes(32).toString('base64url'),
      profile: { nickname, avatarColor },
      preferences: input.preferences,
      socket,
      socketId: socket.id,
      connected: true,
      joinedAt: Date.now(),
      requestCache: new Map(),
      lastInviteAt: new Map(),
      guessEventTimes: [],
      drawEventTimes: [],
    }
    socket.data.playerId = player.id
    this.players.set(player.id, player)
    this.playersByToken.set(player.token, player)
    this.logger.info({ playerId: player.id }, '玩家会话已注册')
    this.broadcastPresence()
    return { player: this.toPublicPlayer(player), recoveryToken: player.token, restored: false }
  }

  updateProfile(
    playerId: string,
    profile: { nickname: string; avatarColor: string },
  ): PublicPlayer {
    const player = this.requirePlayer(playerId)
    // 房间内锁定资料，避免对局期间玩家频繁改名干扰其他成员辨识
    if (player.roomId) throw new GameError('PROFILE_LOCKED', '进入房间后不能修改昵称，请先退出房间')
    const avatarColor = normalizeHexColor(profile.avatarColor)
    if (!avatarColor) throw new GameError('INVALID_AVATAR_COLOR', '头像颜色格式无效')
    // 改名后需要重新做唯一性校验（排除自己当前占用）
    player.profile = {
      nickname: this.makeUniqueNickname(this.cleanNickname(profile.nickname), player.id),
      avatarColor,
    }
    this.broadcastPresence()
    return this.toPublicPlayer(player)
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

  createRoom(playerId: string, input: { name: string; settings: RoomSettings }): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId) // 玩家必须不在其他房间
    this.validateSettings(input.settings)
    // 固定公开房间：默认全选词库，成员只有房主一人，状态版本从 1 开始
    const room: RoomSecret = {
      id: randomUUID(),
      name: input.name.trim(),
      hostId: player.id,
      phase: 'waiting',
      stateVersion: 1,
      settings: input.settings,
      members: [this.createMember(player)],
      selectedWordIds: new Set(this.vocabulary.items.map((word) => word.id)),
      createdAt: Date.now(),
    }
    this.rooms.set(room.id, room)
    this.logger.info({ roomId: room.id, playerId }, '公开房间已创建')
    // 房主加入 Socket 房间并广播大厅更新
    player.roomId = room.id
    player.socket?.join(room.id)
    this.emitRoom(room.id)
    this.broadcastPresence()
    return this.snapshotRoom(room, player.id)
  }

  /**
   * 加入房间：等待阶段按正式成员加入；游戏进行中仅允许 joinPolicy='spectate' 的房间观战加入。
   * 观战成员不占可玩席位判定、不能准备/当画家/猜词/计分，退出后可随时重新正式加入。
   */
  joinRoom(playerId: string, roomId: string): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId)
    const room = this.rooms.get(roomId)
    if (!room || room.phase === 'closed')
      throw new GameError('ROOM_NOT_FOUND', '房间不存在或已经关闭，请从大厅选择其他房间')
    if (room.members.length >= room.settings.maxPlayers)
      throw new GameError('ROOM_FULL', '房间已经满员，请加入其他房间')
    const spectating = room.phase !== 'waiting'
    if (spectating) {
      // 游戏进行中：按 joinPolicy 决定是否允许观战加入
      if (room.settings.joinPolicy === 'forbid')
        throw new GameError('GAME_IN_PROGRESS', '本房间不允许中途加入，请等待下一局')
      if (room.settings.joinPolicy === 'next_game')
        throw new GameError('GAME_IN_PROGRESS', '游戏进行中，请等待下一局开始后再加入')
      // joinPolicy === 'spectate'：以观战身份加入，不打断现有准备节奏
      room.members.push(this.createMember(player, true))
      this.logger.info({ roomId: room.id, playerId }, '玩家以观战身份加入公开房间')
      player.roomId = room.id
      player.socket?.join(room.id)
      this.emitRoom(room.id)
      this.broadcastPresence()
      return this.snapshotRoom(room, player.id)
    }
    room.members.push(this.createMember(player))
    this.logger.info({ roomId: room.id, playerId }, '玩家已加入公开房间')
    player.roomId = room.id
    player.socket?.join(room.id)
    // 新成员加入会打断全员准备节奏，需重新准备
    this.invalidateReady(room, `${player.profile.nickname} 加入了房间，所有人需重新准备`)
    this.emitRoom(room.id)
    this.broadcastPresence()
    return this.snapshotRoom(room, player.id)
  }

  leaveRoom(playerId: string, reason = '主动离开房间'): void {
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
      this.closeRoom(room, '最后一名玩家已离开，房间已关闭')
      return
    }
    if (room.hostId === playerId) this.transferHostInternal(room)
    if (room.phase === 'starting') this.setWaiting(room, '开始倒计时因成员变化而取消')
    else if (room.phase === 'waiting') this.invalidateReady(room, `${reason}，所有人需重新准备`)
    else if (room.phase === 'choosing_word' && room.game?.drawerId === playerId)
      // 画家在选词阶段离开：本回合作废，立即进入下一回合选词（避免回合挂起）
      this.abandonChoosing(room, `${player.profile.nickname} 在选词时离开，本回合作废`)
    else if (room.game?.drawerId === playerId) this.finishRound(room, true) // 画家离开，本回合作废

    // 在线人数不足 2 人时自动暂停比赛
    if (this.onlineMemberCount(room) < APP_CONFIG.player.minPlayers && this.isPlaying(room.phase)) {
      this.pauseRoomInternal(room, '在线玩家不足，比赛已自动暂停')
    }
    this.emitRoom(room.id)
    this.broadcastPresence()
  }

  /** 切换准备状态（仅等待阶段），并递增版本号通知全员；观战者不能准备。 */
  setReady(playerId: string, ready: boolean): RoomSnapshot {
    const { room, member } = this.requireMembership(playerId)
    if (room.phase !== 'waiting') throw new GameError('INVALID_PHASE', '当前阶段不能修改准备状态')
    if (member.spectating)
      throw new GameError('INVALID_PHASE', '观战成员不能准备，须退出后重新加入')
    member.ready = ready
    room.stateVersion += 1
    this.emitRoom(room.id)
    return this.snapshotRoom(room, playerId)
  }

  updateSettings(
    playerId: string,
    patch: Partial<RoomSettings>,
    expectedVersion: number,
  ): RoomSnapshot {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('SETTINGS_LOCKED', '比赛期间规则为只读，请返回房间后修改')
    // 乐观并发控制：版本号不匹配说明有其他玩家改过规则，拒绝本次修改
    if (room.stateVersion !== expectedVersion)
      throw new GameError('VERSION_CONFLICT', '房间状态已更新，请查看最新规则后重试')
    const next = { ...room.settings, ...patch }
    this.validateSettings(next)
    // 最大人数不能小于当前坐席数，否则会出现超员
    if (next.maxPlayers < room.members.length)
      throw new GameError('INVALID_SETTINGS', '最大人数不能少于当前房间人数')
    room.settings = next
    this.invalidateReady(room, '房间规则已修改，所有人需重新准备')
    this.emitRoom(room.id)
    this.broadcastPresence()
    return this.snapshotRoom(room, playerId)
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
      throw new GameError('SETTINGS_LOCKED', '游戏开始后不能修改本局词库')
    if (room.stateVersion !== expectedVersion)
      throw new GameError('VERSION_CONFLICT', '房间状态已变化，请重新确认词库')
    const selected = new Set(ids)
    // 词条数量不足时拒绝保存，保证开局选词阶段有足够候选
    if (selected.size < APP_CONFIG.vocabulary.minWords) {
      throw new GameError(
        'VOCABULARY_TOO_SMALL',
        `至少选择 ${APP_CONFIG.vocabulary.minWords} 个词条`,
      )
    }
    // 每个 ID 都必须来自权威词库，防止伪造词条注入
    for (const id of selected) {
      if (!this.vocabulary.byId.has(id))
        throw new GameError('INVALID_WORD_ID', '选择中包含无效词条，请刷新词库')
    }
    room.selectedWordIds = selected
    this.invalidateReady(room, '本局词库已修改，所有人需重新准备')
    this.emitRoom(room.id)
    return this.getVocabulary(playerId)
  }

  startGame(playerId: string, expectedVersion: number): RoomSnapshot {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting') throw new GameError('INVALID_PHASE', '游戏已经开始或正在倒计时')
    if (room.stateVersion !== expectedVersion)
      throw new GameError('VERSION_CONFLICT', '房间状态已变化，请确认所有人准备后重试')
    // 开局硬性门槛：可玩成员（非观战）至少 2 人、全部在线且全部准备；观战者不参与判定
    const activeMembers = room.members.filter((member) => !member.spectating)
    if (activeMembers.length < APP_CONFIG.player.minPlayers)
      throw new GameError('NOT_ENOUGH_PLAYERS', '至少需要 2 名玩家才能开始')
    if (
      !activeMembers.every((member) => member.ready && this.players.get(member.playerId)?.connected)
    ) {
      throw new GameError('NOT_ALL_READY', '所有在线玩家（包括房主）都准备后才能开始')
    }
    // 本局词条数必须不少于最小词数且覆盖选词候选数
    const requiredWords = Math.max(APP_CONFIG.vocabulary.minWords, room.settings.optionCount)
    if (room.selectedWordIds.size < requiredWords)
      throw new GameError('VOCABULARY_TOO_SMALL', `本局至少需要选择 ${requiredWords} 个词条`)

    // 进入 3 秒开始倒计时阶段；倒计时结束而且阶段未变时正式开局
    this.transition(room, 'starting')
    room.stateVersion += 1
    this.emitRoom(room.id)
    const timer = setTimeout(() => {
      if (room.phase !== 'starting') return
      this.beginGame(room)
    }, APP_CONFIG.game.startingCountdownSeconds * 1_000)
    // 预建本局秘密状态：洗牌确定画家顺序（只含可玩成员），清空所有历史与计时
    room.game = {
      id: randomUUID(),
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
    this.emitRoom(room.id)
    return this.snapshotRoom(room, playerId)
  }

  chooseWord(playerId: string, roundId: string, wordId: string): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    // 只有当前画家在同一回合的选词阶段可以选题
    if (room.phase !== 'choosing_word' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new GameError('NOT_DRAWER', '只有当前画家能在选词阶段选择题目')
    }
    const answer = game.candidates.find((word) => word.id === wordId)
    if (!answer) throw new GameError('INVALID_WORD_ID', '候选词已失效，请等待服务端自动选择')
    this.beginDrawing(room, answer)
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
      throw new GameError('INVALID_PHASE', '当前不能猜词')
    if (game.drawerId === playerId)
      throw new GameError('DRAWER_CANNOT_GUESS', '画家不能发送猜词消息')
    if (member.spectating) throw new GameError('SPECTATOR_CANNOT_GUESS', '观战成员不能参与猜词')
    if (member.guessedAt) throw new GameError('ALREADY_GUESSED', '你已经猜中了，只能发送预设短语')
    const text = rawText.trim()
    this.enforceEventRate(member.playerId, 'guess') // 猜词限频
    if (!text || Array.from(text).length > APP_CONFIG.player.chatMaxLength)
      throw new GameError('INVALID_MESSAGE', '猜词内容为空或过长')
    const normalized = normalizeAnswer(text)
    const answer = normalizeAnswer(game.answer.text)
    // 命中正确答案：计分并广播，返回 correct 标记
    if (normalized === answer) {
      this.markCorrect(room, member)
      return { correct: true, close: false }
    }
    // 未命中但很接近：只提示原发送者，不进入聊天流，避免刷屏泄露
    const close = room.settings.closeGuessEnabled && isCloseAnswer(text, game.answer.text)
    if (close) {
      this.emitToPlayer(playerId, EVENTS.guessClose, { text: '很接近！再想一想' })
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
      throw new GameError('INVALID_PHASE', '当前不能发送互动短语')
    if (member.spectating) throw new GameError('SPECTATOR_CANNOT_CHAT', '观战成员不能发送互动短语')
    if (!(APP_CONFIG.presets.safeChat as readonly string[]).includes(preset))
      throw new GameError('INVALID_MESSAGE', '该互动短语不在安全列表中')
    this.addMessage(room, { type: 'preset', text: preset, playerId })
    this.emitRoom(room.id)
  }

  addStroke(playerId: string, roundId: string, stroke: Stroke): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    // 只有当前画家在作画阶段可以修改画板
    if (room.phase !== 'drawing' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new GameError('NOT_DRAWER', '只有当前画家能修改画板')
    }
    this.enforceEventRate(playerId, 'draw') // 绘图限频
    // 序号必须严格递增，服务端拒绝迟到的旧包（网络乱序/重复发包）
    if (stroke.sequence <= game.lastSequence)
      throw new GameError('STALE_DRAW_EVENT', '绘图包已过期或重复')
    const color = normalizeHexColor(stroke.color)
    // 颜色与线宽均需合法，宽度超出范围也会被拒绝
    if (
      !color ||
      stroke.width < APP_CONFIG.drawing.width.min ||
      stroke.width > APP_CONFIG.drawing.width.max
    ) {
      throw new GameError('INVALID_DRAW_STYLE', '画笔颜色或线宽无效')
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
      throw new GameError('NOT_DRAWER', '只有当前画家能修改画板')
    }
    this.enforceEventRate(playerId, 'draw')
    // 序号必须严格递增，拒绝旧包
    if (fill.sequence <= game.lastSequence)
      throw new GameError('STALE_DRAW_EVENT', '填充命令已过期或重复')
    const color = normalizeHexColor(fill.color)
    if (!color) throw new GameError('INVALID_FILL', '填充颜色无效')
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
    if (!room.settings.allowPause) throw new GameError('PAUSE_DISABLED', '本房间未开启暂停权限')
    const safeReason = reason.trim().slice(0, 40) || '需要短暂暂停'
    // 普通玩家只能发出暂停请求（房主见通知），房主直接执行暂停
    if (room.hostId !== playerId) {
      this.addSystemNotice(room, `${player.profile.nickname} 请求房主暂停：${safeReason}`)
      this.emitRoom(room.id)
      return
    }
    this.pauseRoomInternal(room, safeReason)
    this.emitRoom(room.id)
  }

  resume(playerId: string): void {
    const room = this.requireHostRoom(playerId)
    const game = this.requireGame(room)
    if (room.phase !== 'paused' || !game.phaseBeforePause)
      throw new GameError('INVALID_PHASE', '游戏当前没有暂停')
    // 用暂停时冻结的剩余毫秒重建新的结束时间，继续原阶段
    const next = game.phaseBeforePause
    game.phaseStartedAt = Date.now()
    game.phaseEndsAt = Date.now() + (game.pausedRemainingMs ?? 1_000)
    delete game.phaseBeforePause
    delete game.pausedRemainingMs
    this.transition(room, next)
    this.scheduleCurrentPhase(room)
    this.emitRoom(room.id)
  }

  /** 房主提前结束比赛：仅对局进行中或暂停时可触发，直接进入最终结算。 */
  endEarly(playerId: string): void {
    const room = this.requireHostRoom(playerId)
    if (!this.isPlaying(room.phase) && room.phase !== 'paused')
      throw new GameError('INVALID_PHASE', '当前没有可提前结束的比赛')
    this.finishGame(room, '房主提前结束了本局游戏')
  }

  /** 最终结算后返回等待阶段：释放本局秘密并让全员重新准备。 */
  returnWaiting(playerId: string): void {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'game_result')
      throw new GameError('INVALID_PHASE', '只有最终结算后才能返回房间')
    if (room.game?.timer) clearTimeout(room.game.timer)
    delete room.game
    room.phase = 'waiting'
    this.invalidateReady(room, '已返回房间，请全员重新准备')
    this.emitRoom(room.id)
    this.broadcastPresence()
  }

  kick(playerId: string, targetId: string): void {
    const room = this.requireHostRoom(playerId)
    if (targetId === playerId)
      throw new GameError('INVALID_TARGET', '房主不能移除自己，请使用退出房间')
    if (!room.members.some((member) => member.playerId === targetId))
      throw new GameError('NOT_IN_ROOM', '目标玩家已不在房间')
    // 先通知被踢玩家房间关闭，再走标准离开流程释放座位
    this.emitToPlayer(targetId, EVENTS.roomClosed, { reason: '你已被房主移出房间' })
    this.leaveRoom(targetId, '玩家被房主移出')
  }

  /** 房主主动移交控制权（仅等待阶段）：目标必须是房间成员。 */
  transferHost(playerId: string, targetId: string): void {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting') throw new GameError('INVALID_PHASE', '仅等待阶段可以主动移交房主')
    if (!room.members.some((member) => member.playerId === targetId))
      throw new GameError('NOT_IN_ROOM', '目标玩家不在房间')
    room.hostId = targetId
    room.stateVersion += 1
    this.addSystemNotice(
      room,
      `房主已移交给 ${this.players.get(targetId)?.profile.nickname ?? '新房主'}`,
    )
    this.emitRoom(room.id)
  }

  sendInvite(playerId: string, targetId: string): Invite {
    const { room } = this.requireMembership(playerId)
    const sender = this.requirePlayer(playerId)
    const target = this.requirePlayer(targetId)
    // 邀请前置条件：房间等待中且有席位；非房主邀请需开启 allowPlayerInvite
    if (room.phase !== 'waiting' || room.members.length >= room.settings.maxPlayers)
      throw new GameError('ROOM_NOT_JOINABLE', '房间已开始或已满员，不能邀请')
    if (room.hostId !== playerId && !room.settings.allowPlayerInvite)
      throw new GameError('FORBIDDEN', '本房间仅房主可以邀请')
    // 目标必须在线、不在房间且愿意接收邀请
    if (!target.connected || target.roomId || !target.preferences.acceptsInvites)
      throw new GameError('TARGET_UNAVAILABLE', '该玩家当前无法接收邀请')
    // 同一目标有冷却时间，防止反复骚扰
    const last = sender.lastInviteAt.get(targetId) ?? 0
    if (Date.now() - last < APP_CONFIG.network.inviteCooldownMs)
      throw new GameError('RATE_LIMITED', '邀请发送过于频繁，请稍后再试')
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
    const publicInvite = this.toPublicInvite(invite)
    target.socket?.emit(EVENTS.inviteReceived, publicInvite)
    return publicInvite
  }

  respondInvite(playerId: string, inviteId: string, accept: boolean): RoomSnapshot | undefined {
    const invite = this.invites.get(inviteId)
    // 只允许被邀请者本人应答，且邀请未过期
    if (!invite || invite.toPlayerId !== playerId || invite.expiresAt < Date.now())
      throw new GameError('INVITE_EXPIRED', '邀请已失效，请让对方重新邀请')
    const room = this.rooms.get(invite.roomId)
    this.resolveInvite(inviteId, accept ? 'accepted' : 'declined')
    if (!accept) return undefined
    if (!room) throw new GameError('ROOM_NOT_FOUND', '受邀房间已经关闭')
    // 接受邀请即走标准加入流程；房间满员/游戏进行中会在此处被拒绝
    return this.joinRoom(playerId, room.id)
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
    if (room?.phase === 'starting') this.setWaiting(room, '有玩家掉线，开始倒计时已取消')
    // 画家在作画阶段掉线：给予画家级宽限期，超时未回则当前回合作废
    if (room?.game?.drawerId === playerId && room.phase === 'drawing') {
      setTimeout(() => {
        if (
          !player.connected &&
          player.roomId === room.id &&
          room.game?.drawerId === playerId &&
          room.phase === 'drawing'
        )
          this.finishRound(room, true)
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
          this.abandonChoosing(room, '画家在选词时掉线，本回合作废并重选')
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
            if (previousHost) room.stateVersion += 1
            this.addSystemNotice(
              room,
              `原房主重连超时，控制权已迁移给 ${this.players.get(candidate.playerId)?.profile.nickname ?? '新房主'}`,
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

  /** 大厅在线状态快照：只包含可发现玩家与全部未关闭房间。 */
  presenceSnapshot(): PresenceSnapshot {
    return {
      players: [...this.players.values()]
        .filter((player) => player.preferences.discoverable)
        .map((player) => this.toPublicPlayer(player)),
      rooms: [...this.rooms.values()]
        .filter((room) => room.phase !== 'closed')
        .map((room) => this.toPublicRoom(room)),
    }
  }

  /** 取指定玩家的当前房间快照（用于断线恢复/重同步），不要求玩家在线。 */
  snapshotForPlayer(playerId: string): RoomSnapshot | undefined {
    const player = this.players.get(playerId)
    const room = player?.roomId ? this.rooms.get(player.roomId) : undefined
    return room ? this.snapshotRoom(room, playerId) : undefined
  }

  /**
   * 画家在选词阶段离开/掉线时废弃当前回合，立即进入下一回合选词。
   * 先把阶段切到 round_result（从 choosing_word 出发的合法转换），再走统一的开局流程，
   * 避免选词计时器空转导致整轮挂起。
   */
  private abandonChoosing(room: RoomSecret, notice: string): void {
    const game = this.requireGame(room)
    if (game.timer) clearTimeout(game.timer)
    // 清掉暂停残留字段（若之前在暂停态），保证后续状态干净
    delete game.phaseBeforePause
    delete game.pausedRemainingMs
    this.transition(room, 'round_result')
    this.addSystemNotice(room, notice)
    this.beginChoosing(room)
  }

  private beginGame(room: RoomSecret): void {
    if (room.game?.timer) clearTimeout(room.game.timer)
    // 重置全员准备位、得分、猜中时间与统计，进入第一回合选词
    room.members.forEach((member) => {
      member.ready = false
      member.score = 0
      member.guessedAt = undefined
      member.stats = { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 }
    })
    this.beginChoosing(room)
    this.broadcastPresence()
  }

  private beginChoosing(room: RoomSecret): void {
    const game = this.requireGame(room)
    game.currentRound += 1
    // 全部回合完成则进入最终结算
    if (game.currentRound > game.totalRounds) {
      this.finishGame(room, '全部回合完成')
      return
    }
    // 按顺序选下一个在线的画家；没有可用画家则提前结算
    const drawer = this.findNextDrawer(room, game)
    if (!drawer) {
      this.finishGame(room, '没有可继续作画的在线玩家')
      return
    }
    // 初始化本轮：随机候选词、空画布、空消息、重置猜中位
    this.transition(room, 'choosing_word')
    game.drawerId = drawer // 指定当前画家（在切阶段后立即赋值）
    game.roundId = randomUUID()
    game.candidates = this.pickCandidates(room, game)
    game.answer = undefined
    game.strokes = []
    game.undoneStrokeIds = []
    game.lastSequence = -1
    game.messages = []
    game.correctOrder = []
    game.revealedIndices = new Set()
    game.roundResult = undefined
    room.members.forEach((member) => (member.guessedAt = undefined))
    game.phaseStartedAt = Date.now()
    game.phaseEndsAt = Date.now() + room.settings.chooseSeconds * 1_000
    // 选词超时：服务端随机选择一个候选词并直接开画
    game.timer = setTimeout(() => {
      const candidate = game.candidates[Math.floor(Math.random() * game.candidates.length)]
      if (candidate && room.phase === 'choosing_word') this.beginDrawing(room, candidate)
    }, room.settings.chooseSeconds * 1_000)
    this.emitRoom(room.id)
  }

  private beginDrawing(room: RoomSecret, answer: { id: string; text: string }): void {
    const game = this.requireGame(room)
    if (game.timer) clearTimeout(game.timer)
    this.transition(room, 'drawing')
    game.answer = answer
    game.usedWordIds.add(answer.id) // 记录已用词条，避免后续回合重复
    game.phaseStartedAt = Date.now()
    game.phaseEndsAt = Date.now() + room.settings.drawSeconds * 1_000
    // 作画倒计时结束进入回合结算
    game.timer = setTimeout(() => this.finishRound(room, false), room.settings.drawSeconds * 1_000)
    this.scheduleHints(room) // 若开启逐步提示则安排揭示计时器
    this.addSystemNotice(room, '作画开始，猜词玩家请在右侧输入答案')
    this.emitRoom(room.id)
  }

  private markCorrect(room: RoomSecret, member: MemberState): void {
    const game = this.requireGame(room)
    if (member.guessedAt) return // 防重复计分
    member.guessedAt = Date.now()
    game.correctOrder.push(member.playerId)
    // 按可玩成员数（排除观战）计算速度奖励和顺序奖励，累加到成员总分
    const activePlayerCount = room.members.filter((item) => !item.spectating).length
    const detail = calculateGuessScore({
      elapsedMs: member.guessedAt - game.phaseStartedAt,
      durationMs: room.settings.drawSeconds * 1_000,
      correctOrder: game.correctOrder.length,
      playerCount: activePlayerCount,
      base: APP_CONFIG.game.score.guessBase,
      maxSpeedBonus: APP_CONFIG.game.score.maxSpeedBonus,
      orderBonuses: APP_CONFIG.game.score.orderBonuses,
    })
    member.score += detail.total
    member.stats.correctCount += 1
    member.stats.totalGuessMs += member.guessedAt - game.phaseStartedAt
    // 广播猜中消息与顺序信息（不含答案正文）
    this.addMessage(room, {
      type: 'correct',
      text: `${this.players.get(member.playerId)?.profile.nickname ?? '玩家'} 猜中了！`,
      playerId: member.playerId,
    })
    this.io
      .to(room.id)
      .emit(EVENTS.guessCorrect, { playerId: member.playerId, order: game.correctOrder.length })
    // 所有有效猜词者（可玩成员，排除观战）都已猜中时立即结束本回合，否则刷新房间快照
    const eligible = room.members.filter(
      (candidate) =>
        candidate.playerId !== game.drawerId &&
        !candidate.spectating &&
        this.players.get(candidate.playerId)?.connected,
    )
    if (eligible.length > 0 && eligible.every((candidate) => candidate.guessedAt))
      this.finishRound(room, false)
    else this.emitRoom(room.id)
  }

  private finishRound(room: RoomSecret, drawerAbandoned: boolean): void {
    const game = room.game
    // 只有回合进行中（含暂停兜底）且答案已定时才结算
    if (!game || !game.answer || !['drawing', 'paused'].includes(room.phase)) return
    // 可玩成员（排除观战者）数量：计分与满员判定统一用它
    const activeMembers = room.members.filter((member) => !member.spectating)
    this.clearHintTimers(game)
    if (game.timer) clearTimeout(game.timer)
    // 若从暂停态结算，先复位到 drawing 以走合法转换，并清理暂停残留字段
    if (room.phase === 'paused') {
      room.phase = 'drawing'
      delete game.phaseBeforePause
      delete game.pausedRemainingMs
    }
    this.transition(room, 'round_result')
    // 为每个猜中者重建得分明细（与猜中时同规则），用于结算面板展示
    const details = game.correctOrder.map((playerId, index) => {
      const member = room.members.find((candidate) => candidate.playerId === playerId)
      const guessedAt = member?.guessedAt ?? game.phaseEndsAt
      return {
        playerId,
        ...calculateGuessScore({
          elapsedMs: guessedAt - game.phaseStartedAt,
          durationMs: room.settings.drawSeconds * 1_000,
          correctOrder: index + 1,
          playerCount: activeMembers.length, // 与猜中时同口径：按可玩成员数计算
          base: APP_CONFIG.game.score.guessBase,
          maxSpeedBonus: APP_CONFIG.game.score.maxSpeedBonus,
          orderBonuses: APP_CONFIG.game.score.orderBonuses,
        }),
      }
    })
    // 画家得分：每个猜中者计一件，全员猜中另有满员奖励（均排除观战成员）
    const allGuessers = room.members.filter(
      (member) =>
        member.playerId !== game.drawerId &&
        !member.spectating &&
        this.players.get(member.playerId)?.connected,
    )
    const allCorrect = allGuessers.length > 0 && allGuessers.every((member) => member.guessedAt)
    const drawerScore = drawerAbandoned
      ? 0
      : game.correctOrder.length * APP_CONFIG.game.score.drawerPerCorrect +
        (allCorrect ? APP_CONFIG.game.score.drawerAllCorrectBonus : 0)
    const drawer = room.members.find((member) => member.playerId === game.drawerId)
    if (drawer) {
      drawer.score += drawerScore
      drawer.stats.drawingCorrectCount += game.correctOrder.length
    }
    // 保存结算数据并开启 6 秒结算展示窗口，之后进入下一回合选词
    const result: RoundResult = { answer: game.answer.text, details, drawerScore }
    game.roundResult = result
    game.phaseStartedAt = Date.now()
    game.phaseEndsAt = Date.now() + APP_CONFIG.game.roundResultSeconds * 1_000
    game.timer = setTimeout(
      () => this.beginChoosing(room),
      APP_CONFIG.game.roundResultSeconds * 1_000,
    )
    this.emitRoom(room.id)
  }

  private finishGame(room: RoomSecret, reason: string): void {
    const game = this.requireGame(room)
    this.clearHintTimers(game)
    if (game.timer) clearTimeout(game.timer)
    // 从暂停态结束时要先回到暂停前阶段，再走合法转换到 game_result，并清理暂停字段
    if (room.phase === 'paused') {
      room.phase = game.phaseBeforePause ?? 'drawing'
      delete game.phaseBeforePause
      delete game.pausedRemainingMs
    }
    if (room.phase !== 'game_result') {
      if (!canTransition(room.phase, 'game_result')) room.phase = 'drawing'
      this.transition(room, 'game_result')
    }
    game.phaseStartedAt = Date.now()
    game.phaseEndsAt = 0
    this.addSystemNotice(room, reason)
    this.emitRoom(room.id)
    this.broadcastPresence()
  }

  private pauseRoomInternal(room: RoomSecret, reason: string): void {
    // 只有对局中的阶段（开始/选词/作画/结算）可以暂停
    if (!this.isPlaying(room.phase) || room.phase === 'paused') return
    const game = this.requireGame(room)
    this.clearHintTimers(game)
    if (game.timer) clearTimeout(game.timer)
    // 冻结当前阶段与剩余毫秒，暂停期间所有计时停止
    game.phaseBeforePause = room.phase
    game.pausedRemainingMs = Math.max(0, game.phaseEndsAt - Date.now())
    this.transition(room, 'paused')
    game.phaseEndsAt = 0
    this.addSystemNotice(room, reason)
  }

  private scheduleCurrentPhase(room: RoomSecret): void {
    const game = this.requireGame(room)
    // 暂停恢复后按冻结的剩余毫秒重新调度当前阶段计时器
    const delay = Math.max(0, game.phaseEndsAt - Date.now())
    if (game.timer) clearTimeout(game.timer)
    if (room.phase === 'choosing_word') {
      // 恢复选词阶段：超时后取第一个候选词自动开画
      game.timer = setTimeout(() => {
        const candidate = game.candidates[0]
        if (candidate) this.beginDrawing(room, candidate)
      }, delay)
    } else if (room.phase === 'drawing') {
      game.timer = setTimeout(() => this.finishRound(room, false), delay)
      this.scheduleHints(room) // 同时重建逐步提示计时器
    } else if (room.phase === 'round_result')
      game.timer = setTimeout(() => this.beginChoosing(room), delay)
  }

  private setWaiting(room: RoomSecret, notice: string): void {
    // 把房间状态重置回等待：清理对局秘密、提示计时器与全员准备
    if (room.game) this.clearHintTimers(room.game)
    if (room.game?.timer) clearTimeout(room.game.timer)
    delete room.game
    room.phase = 'waiting'
    this.invalidateReady(room, notice)
    this.emitRoom(room.id)
  }

  /** 执行合法的阶段转换；非法转换直接抛错，绝不自作主张切换。转换后版本号 +1。 */
  private transition(room: RoomSecret, next: RoomPhase): void {
    if (!canTransition(room.phase, next))
      throw new GameError('INVALID_TRANSITION', `非法状态转换：${room.phase} → ${next}`)
    const previous = room.phase
    room.phase = next
    this.logger.info({ roomId: room.id, from: previous, to: next }, '房间阶段已转换')
    room.stateVersion += 1
  }

  /**
   * 为指定观看者生成裁剪后的房间快照。
   * 画家能看到答案与候选词；猜词者只能看到遮罩；结算阶段全员都能看到答案。
   */
  private snapshotRoom(room: RoomSecret, viewerId: string): RoomSnapshot {
    const game = room.game
    const viewerIsDrawer = game?.drawerId === viewerId
    // E4 快照差分：若观看者已在线同步全部绘图增量（lastSyncedSeq 追平 lastSequence），
    // 快照用空数组 + strokesOmitted 标记省略画布历史，由客户端沿用本地已有笔画，降低序列化开销。
    const viewerMember = room.members.find((member) => member.playerId === viewerId)
    const canOmitStrokes =
      Boolean(game) &&
      game!.strokes.length > 0 &&
      viewerMember?.lastSyncedSeq !== undefined &&
      viewerMember.lastSyncedSeq >= game!.lastSequence &&
      Boolean(this.players.get(viewerId)?.connected)
    // 按观看者角色裁剪对局视图的敏感字段
    const gameView: GameView | undefined = game
      ? {
          gameId: game.id,
          roundId: game.roundId,
          ...(game.phaseBeforePause ? { phaseBeforePause: game.phaseBeforePause } : {}),
          currentRound: game.currentRound,
          totalRounds: game.totalRounds,
          drawerId: game.drawerId,
          phaseStartedAt: game.phaseStartedAt,
          phaseEndsAt: game.phaseEndsAt,
          // 答案展示规则：结算阶段公开全文；否则按设置显示遮罩或隐藏字数
          answerMask: game.answer
            ? room.phase === 'round_result' || room.phase === 'game_result'
              ? game.answer.text
              : room.settings.showWordLength
                ? createAnswerMask(game.answer.text, game.revealedIndices)
                : '答案长度已隐藏'
            : '',
          // 画家才可看到真实答案与候选词
          ...(viewerIsDrawer && game.answer ? { answer: game.answer.text } : {}),
          ...(viewerIsDrawer && room.phase === 'choosing_word'
            ? { wordOptions: game.candidates.map((word) => ({ id: word.id, text: word.text })) }
            : {}),
          strokes: canOmitStrokes ? [] : game.strokes,
          ...(canOmitStrokes ? { strokesOmitted: true } : {}),
          undoneStrokeIds: game.undoneStrokeIds,
          lastSequence: game.lastSequence, // 下发已接受的最大绘图序号，供重连客户端续起
          messages: game.messages.slice(-APP_CONFIG.ui.recentMessageCount),
          ...(game.roundResult ? { roundResult: game.roundResult } : {}),
        }
      : undefined
    return {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      phase: room.phase,
      stateVersion: room.stateVersion,
      settings: room.settings,
      // 成员视图：公开身份 + 局内状态，注意不包含服务端秘密字段
      members: room.members.map((member) => {
        const player = this.requirePlayer(member.playerId)
        return {
          ...this.toPublicPlayer(player),
          ready: member.ready,
          score: member.score,
          isHost: room.hostId === member.playerId,
          isDrawer: game?.drawerId === member.playerId,
          guessed: Boolean(member.guessedAt),
          spectating: Boolean(member.spectating),
          connection: player.connected ? 'online' : 'reconnecting',
          stats: member.stats,
        }
      }),
      selectedWordCount: room.selectedWordIds.size,
      totalWordCount: this.vocabulary.items.length,
      ...(gameView ? { game: gameView } : {}),
    }
  }

  /**
   * 向房间所有成员推送各自的角色裁剪快照。
   * 每个成员看到的答案/候选词不同，因此必须以成员为观看者分别生成。
   */
  private emitRoom(roomId?: string): void {
    if (!roomId) return
    const room = this.rooms.get(roomId)
    if (!room) return
    for (const member of room.members) {
      const player = this.players.get(member.playerId)
      player?.socket?.emit(EVENTS.roomSnapshot, this.snapshotRoom(room, member.playerId))
    }
  }

  /**
   * 在线玩家与公开房间列表同源广播；独立 room:listChanged 事件让大厅可明确订阅房间变化，
   * presence:snapshot 则继续承担初始全量同步和向后兼容。
   */
  private broadcastPresence(): void {
    const snapshot = this.presenceSnapshot()
    this.io.emit(EVENTS.presenceSnapshot, snapshot)
    this.io.emit(EVENTS.roomListChanged, snapshot.rooms)
  }

  private toPublicPlayer(player: PlayerSecret): PublicPlayer {
    // 根据连接状态与所在房间计算玩家在场状态
    const room = player.roomId ? this.rooms.get(player.roomId) : undefined
    const status = !player.connected
      ? 'reconnecting'
      : room
        ? this.isPlaying(room.phase)
          ? 'playing'
          : 'in_room'
        : 'idle'
    return {
      id: player.id,
      nickname: player.profile.nickname,
      avatarColor: player.profile.avatarColor,
      status,
      ...(room ? { roomId: room.id } : {}),
    }
  }

  private toPublicRoom(room: RoomSecret): PublicRoom {
    // 大厅行只暴露无敏感信息的摘要字段
    return {
      id: room.id,
      name: room.name,
      hostName: this.players.get(room.hostId)?.profile.nickname ?? '未知房主',
      playerCount: room.members.length,
      maxPlayers: room.settings.maxPlayers,
      phase: room.phase,
      roundsPerPlayer: room.settings.roundsPerPlayer,
      drawSeconds: room.settings.drawSeconds,
      joinPolicy: room.settings.joinPolicy, // 大厅据此判断能否观战加入
    }
  }

  private toPublicInvite(invite: InviteSecret): Invite {
    const room = this.rooms.get(invite.roomId)
    const sender = this.requirePlayer(invite.fromPlayerId)
    if (!room) throw new GameError('ROOM_NOT_FOUND', '邀请房间已关闭')
    return {
      id: invite.id,
      roomId: room.id,
      roomName: room.name,
      from: this.toPublicPlayer(sender),
      expiresAt: invite.expiresAt,
    }
  }

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
    if (player.roomId) this.leaveRoom(playerId, '玩家重连超时离开')
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
    this.rooms.delete(room.id)
    this.broadcastPresence()
  }

  private transferHostInternal(room: RoomSecret): void {
    // 房主离开/超时后把控制权迁移给第一个在线的可玩成员（观战者不能任房主），
    // 没有在线成员则取第一个非观战成员
    const candidate =
      room.members.find(
        (member) => !member.spectating && this.players.get(member.playerId)?.connected,
      ) ?? room.members.find((member) => !member.spectating)
    if (!candidate) return
    room.hostId = candidate.playerId
    this.addSystemNotice(
      room,
      `房主已迁移给 ${this.players.get(candidate.playerId)?.profile.nickname ?? '新房主'}`,
    )
  }

  private invalidateReady(room: RoomSecret, notice: string): void {
    // 成员变化/规则变化后全员取消准备并广播通知
    room.members.forEach((member) => (member.ready = false))
    room.stateVersion += 1
    this.addSystemNotice(room, notice)
  }

  private addMessage(room: RoomSecret, input: Omit<ChatMessage, 'id' | 'createdAt'>): void {
    const game = this.requireGame(room)
    game.messages.push({ ...input, id: randomUUID(), createdAt: Date.now() })
    // 消息只保留最近两倍展示数量，防止内存无限增长
    game.messages = game.messages.slice(-APP_CONFIG.ui.recentMessageCount * 2)
  }

  private addSystemNotice(room: RoomSecret, text: string): void {
    // 系统通知同时进入消息历史和作为独立事件推送（即使尚无对局也能收到）
    if (room.game) this.addMessage(room, { type: 'system', text })
    this.io.to(room.id).emit(EVENTS.systemNotice, { text })
  }

  /**
   * 按剩余时间阈值安排提示。
   * 剩余比例降到某个阈值以下时揭示一个非标点字符（如 [0.35, 0.2] 表示两次揭示），
   * 且每次揭示后仍保留至少一个字符未知，因此提示只缩小范围而不会直接泄露答案。
   */
  private scheduleHints(room: RoomSecret): void {
    const game = this.requireGame(room)
    this.clearHintTimers(game)
    if (!room.settings.progressiveHints || !game.answer || room.phase !== 'drawing') return
    const totalMs = room.settings.drawSeconds * 1_000
    const remainingRatio = Math.max(0, Math.min(1, (game.phaseEndsAt - Date.now()) / totalMs))
    game.hintTimers = APP_CONFIG.game.finalHintThresholds
      .filter((threshold) => threshold < remainingRatio)
      .map((threshold) =>
        setTimeout(
          () => this.revealHint(room),
          Math.max(0, (remainingRatio - threshold) * totalMs),
        ),
      )
  }

  private revealHint(room: RoomSecret): void {
    const game = room.game
    if (!game?.answer || room.phase !== 'drawing') return
    // 筛选出尚未揭示的非标点/空白字符作为待揭示候选
    const candidates = Array.from(game.answer.text)
      .map((character, index) => ({ character, index }))
      .filter(
        ({ character, index }) =>
          !/^[\p{P}\p{Z}\s]$/u.test(character) && !game.revealedIndices.has(index),
      )
    // 只剩一个字符时不再揭示，避免答案被完全泄露
    if (candidates.length <= 1) return
    // 随机揭示其中一个字符下标
    const target = candidates[Math.floor(Math.random() * candidates.length)]
    if (target) game.revealedIndices.add(target.index)
    this.emitRoom(room.id)
  }

  private clearHintTimers(game: GameSecret): void {
    // 清理全部逐步提示计时器，防止暂停/切换阶段后旧回调误触发
    for (const timer of game.hintTimers ?? []) clearTimeout(timer)
    game.hintTimers = []
  }

  /** 对高频输入使用一秒滑动窗口，拒绝刷包以保护计时与聊天事件。 */
  private enforceEventRate(playerId: string, kind: 'guess' | 'draw'): void {
    const player = this.requirePlayer(playerId)
    const now = Date.now()
    const history = (kind === 'guess' ? player.guessEventTimes : player.drawEventTimes).filter(
      (time) => now - time < 1_000,
    )
    const limit =
      kind === 'guess'
        ? APP_CONFIG.network.guessEventsPerSecond
        : APP_CONFIG.drawing.maxDrawEventsPerSecond
    if (history.length >= limit) throw new GameError('RATE_LIMITED', '操作过于频繁，请稍后再试')
    history.push(now)
    if (kind === 'guess') player.guessEventTimes = history
    else player.drawEventTimes = history
  }

  private pickCandidates(room: RoomSecret, game: GameSecret) {
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

  private findNextDrawer(room: RoomSecret, game: GameSecret): string | undefined {
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
        `昵称需为 ${APP_CONFIG.player.nicknameMinLength}～${APP_CONFIG.player.nicknameMaxLength} 个可见字符`,
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
    throw new GameError('DUPLICATE_NICKNAME', '昵称已被占用，请换一个昵称')
  }

  /** 校验房间规则：所有数值都必须在 config.ts 允许范围内（服务端权威兜底）。 */
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
    if (!valid) throw new GameError('INVALID_SETTINGS', '房间规则超出服务器允许范围')
  }

  /** 按玩家 ID 取身份，不存在时抛 UNAUTHORIZED。 */
  private requirePlayer(playerId: string): PlayerSecret {
    const player = this.players.get(playerId)
    if (!player) throw new GameError('UNAUTHORIZED', '身份已失效，请重新进入游戏')
    return player
  }

  /** 取身份并要求玩家当前不在任何房间（用于建房间/加入房间）。 */
  private requireAvailablePlayer(playerId: string): PlayerSecret {
    const player = this.requirePlayer(playerId)
    if (player.roomId) throw new GameError('ALREADY_IN_ROOM', '你已经在一个房间中，请先退出')
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
    if (!room || !member) throw new GameError('NOT_IN_ROOM', '你当前不在房间中')
    return { player, room, member }
  }

  /** 取房间并要求调用者为房主，否则抛 FORBIDDEN。 */
  private requireHostRoom(playerId: string): RoomSecret {
    const { room } = this.requireMembership(playerId)
    if (room.hostId !== playerId) throw new GameError('FORBIDDEN', '只有房主可以执行此操作')
    return room
  }

  /** 取对局秘密，房间没有进行中的游戏时抛 NO_GAME。 */
  private requireGame(room: RoomSecret): GameSecret {
    if (!room.game) throw new GameError('NO_GAME', '当前房间没有进行中的游戏')
    return room.game
  }

  /** 取对局并要求调用者是当前回合画家（绘图权限守卫）。 */
  private requireDrawerGame(room: RoomSecret, playerId: string, roundId: string): GameSecret {
    const game = this.requireGame(room)
    if (room.phase !== 'drawing' || game.drawerId !== playerId || game.roundId !== roundId)
      throw new GameError('NOT_DRAWER', '只有当前画家可以修改画板')
    return game
  }

  /** 统计房间内当前在线的可玩成员数（排除观战者与断线宽限期玩家）。 */
  private onlineMemberCount(room: RoomSecret): number {
    return room.members.filter(
      (member) => !member.spectating && this.players.get(member.playerId)?.connected,
    ).length
  }

  /** 是否为对局中的阶段（可用于暂停判定）。 */
  private isPlaying(phase: RoomPhase): boolean {
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
