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
}

const SILENT_LOGGER: RuntimeLogger = { info: () => undefined }

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
    if (input.protocolVersion !== APP_CONFIG.app.protocolVersion) {
      throw new GameError('PROTOCOL_MISMATCH', '客户端版本与服务器不兼容，请刷新或更新页面')
    }
    const avatarColor = normalizeHexColor(input.profile.avatarColor)
    if (!avatarColor) throw new GameError('INVALID_AVATAR_COLOR', '头像颜色格式无效，请重新选择')

    const recovering = input.recoveryToken
      ? this.playersByToken.get(input.recoveryToken)
      : undefined
    if (
      recovering &&
      (!recovering.disconnectedAt ||
        Date.now() - recovering.disconnectedAt <= APP_CONFIG.network.reconnectGraceMs)
    ) {
      if (recovering.disconnectTimer) clearTimeout(recovering.disconnectTimer)
      recovering.socket?.disconnect(true)
      recovering.socket = socket
      recovering.socketId = socket.id
      recovering.connected = true
      delete recovering.disconnectedAt
      delete recovering.disconnectTimer
      socket.data.playerId = recovering.id
      this.joinSocketRoom(recovering)
      this.emitRoom(recovering.roomId)
      this.broadcastPresence()
      return {
        player: this.toPublicPlayer(recovering),
        recoveryToken: recovering.token,
        restored: true,
      }
    }

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
    if (player.roomId) throw new GameError('PROFILE_LOCKED', '进入房间后不能修改昵称，请先退出房间')
    const avatarColor = normalizeHexColor(profile.avatarColor)
    if (!avatarColor) throw new GameError('INVALID_AVATAR_COLOR', '头像颜色格式无效')
    player.profile = {
      nickname: this.makeUniqueNickname(this.cleanNickname(profile.nickname), player.id),
      avatarColor,
    }
    this.broadcastPresence()
    return this.toPublicPlayer(player)
  }

  updatePreferences(
    playerId: string,
    preferences: { discoverable: boolean; acceptsInvites: boolean },
  ): void {
    const player = this.requirePlayer(playerId)
    player.preferences = preferences
    this.broadcastPresence()
  }

  createRoom(playerId: string, input: { name: string; settings: RoomSettings }): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId)
    this.validateSettings(input.settings)
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
    player.roomId = room.id
    player.socket?.join(room.id)
    this.emitRoom(room.id)
    this.broadcastPresence()
    return this.snapshotRoom(room, player.id)
  }

  joinRoom(playerId: string, roomId: string): RoomSnapshot {
    const player = this.requireAvailablePlayer(playerId)
    const room = this.rooms.get(roomId)
    if (!room || room.phase === 'closed')
      throw new GameError('ROOM_NOT_FOUND', '房间不存在或已经关闭，请从大厅选择其他房间')
    if (room.members.length >= room.settings.maxPlayers)
      throw new GameError('ROOM_FULL', '房间已经满员，请加入其他房间')
    if (room.phase !== 'waiting')
      throw new GameError('GAME_IN_PROGRESS', '游戏已经开始，请等待下一局')
    room.members.push(this.createMember(player))
    this.logger.info({ roomId: room.id, playerId }, '玩家已加入公开房间')
    player.roomId = room.id
    player.socket?.join(room.id)
    this.invalidateReady(room, `${player.profile.nickname} 加入了房间，所有人需重新准备`)
    this.emitRoom(room.id)
    this.broadcastPresence()
    return this.snapshotRoom(room, player.id)
  }

  leaveRoom(playerId: string, reason = '主动离开房间'): void {
    const player = this.requirePlayer(playerId)
    if (!player.roomId) return
    const room = this.rooms.get(player.roomId)
    if (!room) {
      delete player.roomId
      return
    }
    player.socket?.leave(room.id)
    room.members = room.members.filter((member) => member.playerId !== playerId)
    this.logger.info({ roomId: room.id, playerId, reason }, '玩家已离开房间')
    delete player.roomId
    room.stateVersion += 1

    if (room.members.length === 0) {
      this.closeRoom(room, '最后一名玩家已离开，房间已关闭')
      return
    }
    if (room.hostId === playerId) this.transferHostInternal(room)
    if (room.phase === 'starting') this.setWaiting(room, '开始倒计时因成员变化而取消')
    else if (room.phase === 'waiting') this.invalidateReady(room, `${reason}，所有人需重新准备`)
    else if (room.game?.drawerId === playerId) this.finishRound(room, true)
    if (this.onlineMemberCount(room) < APP_CONFIG.player.minPlayers && this.isPlaying(room.phase)) {
      this.pauseRoomInternal(room, '在线玩家不足，比赛已自动暂停')
    }
    this.emitRoom(room.id)
    this.broadcastPresence()
  }

  setReady(playerId: string, ready: boolean): RoomSnapshot {
    const { room, member } = this.requireMembership(playerId)
    if (room.phase !== 'waiting') throw new GameError('INVALID_PHASE', '当前阶段不能修改准备状态')
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
    if (room.stateVersion !== expectedVersion)
      throw new GameError('VERSION_CONFLICT', '房间状态已更新，请查看最新规则后重试')
    const next = { ...room.settings, ...patch }
    this.validateSettings(next)
    if (next.maxPlayers < room.members.length)
      throw new GameError('INVALID_SETTINGS', '最大人数不能少于当前房间人数')
    room.settings = next
    this.invalidateReady(room, '房间规则已修改，所有人需重新准备')
    this.emitRoom(room.id)
    this.broadcastPresence()
    return this.snapshotRoom(room, playerId)
  }

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
    if (selected.size < APP_CONFIG.vocabulary.minWords) {
      throw new GameError(
        'VOCABULARY_TOO_SMALL',
        `至少选择 ${APP_CONFIG.vocabulary.minWords} 个词条`,
      )
    }
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
    if (room.members.length < APP_CONFIG.player.minPlayers)
      throw new GameError('NOT_ENOUGH_PLAYERS', '至少需要 2 名玩家才能开始')
    if (
      !room.members.every((member) => member.ready && this.players.get(member.playerId)?.connected)
    ) {
      throw new GameError('NOT_ALL_READY', '所有在线玩家（包括房主）都准备后才能开始')
    }
    const requiredWords = Math.max(APP_CONFIG.vocabulary.minWords, room.settings.optionCount)
    if (room.selectedWordIds.size < requiredWords)
      throw new GameError('VOCABULARY_TOO_SMALL', `本局至少需要选择 ${requiredWords} 个词条`)

    this.transition(room, 'starting')
    room.stateVersion += 1
    this.emitRoom(room.id)
    const timer = setTimeout(() => {
      if (room.phase !== 'starting') return
      this.beginGame(room)
    }, APP_CONFIG.game.startingCountdownSeconds * 1_000)
    room.game = {
      id: randomUUID(),
      roundId: '',
      phaseStartedAt: Date.now(),
      phaseEndsAt: Date.now() + APP_CONFIG.game.startingCountdownSeconds * 1_000,
      currentRound: 0,
      totalRounds: room.members.length * room.settings.roundsPerPlayer,
      drawerOrder: this.shuffle(room.members.map((member) => member.playerId)),
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
    if (room.phase !== 'drawing' || game.roundId !== roundId || !game.answer)
      throw new GameError('INVALID_PHASE', '当前不能猜词')
    if (game.drawerId === playerId)
      throw new GameError('DRAWER_CANNOT_GUESS', '画家不能发送猜词消息')
    if (member.guessedAt) throw new GameError('ALREADY_GUESSED', '你已经猜中了，只能发送预设短语')
    const text = rawText.trim()
    this.enforceEventRate(member.playerId, 'guess')
    if (!text || Array.from(text).length > APP_CONFIG.player.chatMaxLength)
      throw new GameError('INVALID_MESSAGE', '猜词内容为空或过长')
    const normalized = normalizeAnswer(text)
    const answer = normalizeAnswer(game.answer.text)
    if (normalized === answer) {
      this.markCorrect(room, member)
      return { correct: true, close: false }
    }
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
    const { room } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    if (room.phase !== 'drawing' || game.roundId !== roundId)
      throw new GameError('INVALID_PHASE', '当前不能发送互动短语')
    if (!(APP_CONFIG.presets.safeChat as readonly string[]).includes(preset))
      throw new GameError('INVALID_MESSAGE', '该互动短语不在安全列表中')
    this.addMessage(room, { type: 'preset', text: preset, playerId })
    this.emitRoom(room.id)
  }

  addStroke(playerId: string, roundId: string, stroke: Stroke): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    if (room.phase !== 'drawing' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new GameError('NOT_DRAWER', '只有当前画家能修改画板')
    }
    this.enforceEventRate(playerId, 'draw')
    if (stroke.sequence <= game.lastSequence)
      throw new GameError('STALE_DRAW_EVENT', '绘图包已过期或重复')
    const color = normalizeHexColor(stroke.color)
    if (
      !color ||
      stroke.width < APP_CONFIG.drawing.width.min ||
      stroke.width > APP_CONFIG.drawing.width.max
    ) {
      throw new GameError('INVALID_DRAW_STYLE', '画笔颜色或线宽无效')
    }
    game.lastSequence = stroke.sequence
    const existing = game.strokes.find(
      (candidate): candidate is Stroke => candidate.kind === 'stroke' && candidate.id === stroke.id,
    )
    if (existing) {
      // 同一按下动作的后续批次沿用笔画 ID；只追加新增点，撤销仍能一次移除完整笔画。
      existing.points.push(...stroke.points)
      existing.sequence = stroke.sequence
    } else {
      game.strokes.push({ ...stroke, color, points: [...stroke.points] })
      if (game.strokes.length > APP_CONFIG.drawing.maxHistoryCommands) game.strokes.shift()
    }
    game.undoneStrokeIds = []
    this.io.to(room.id).emit(EVENTS.drawStrokeBatch, { roundId, stroke: { ...stroke, color } })
  }

  /** 校验并提交封闭区域填充命令；客户端只上传点击位置和颜色，不上传像素数据。 */
  addFill(playerId: string, roundId: string, fill: FillCommand): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    if (room.phase !== 'drawing' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new GameError('NOT_DRAWER', '只有当前画家能修改画板')
    }
    this.enforceEventRate(playerId, 'draw')
    if (fill.sequence <= game.lastSequence)
      throw new GameError('STALE_DRAW_EVENT', '填充命令已过期或重复')
    const color = normalizeHexColor(fill.color)
    if (!color) throw new GameError('INVALID_FILL', '填充颜色无效')
    game.lastSequence = fill.sequence
    game.strokes.push({ ...fill, color })
    if (game.strokes.length > APP_CONFIG.drawing.maxHistoryCommands) game.strokes.shift()
    game.undoneStrokeIds = []
    this.io.to(room.id).emit(EVENTS.drawFillCommit, {
      roundId,
      fill: { ...fill, color },
    })
  }

  undo(playerId: string, roundId: string): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireDrawerGame(room, playerId, roundId)
    const target = [...game.strokes]
      .reverse()
      .find((stroke) => !game.undoneStrokeIds.includes(stroke.id))
    if (target) game.undoneStrokeIds.push(target.id)
    this.emitRoom(room.id)
  }

  redo(playerId: string, roundId: string): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireDrawerGame(room, playerId, roundId)
    game.undoneStrokeIds.pop()
    this.emitRoom(room.id)
  }

  clearDrawing(playerId: string, roundId: string): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireDrawerGame(room, playerId, roundId)
    game.strokes = []
    game.undoneStrokeIds = []
    game.lastSequence += 1
    this.emitRoom(room.id)
  }

  pause(playerId: string, reason: string): void {
    const { room, player } = this.requireMembership(playerId)
    if (!room.settings.allowPause) throw new GameError('PAUSE_DISABLED', '本房间未开启暂停权限')
    const safeReason = reason.trim().slice(0, 40) || '需要短暂暂停'
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
    const next = game.phaseBeforePause
    game.phaseStartedAt = Date.now()
    game.phaseEndsAt = Date.now() + (game.pausedRemainingMs ?? 1_000)
    delete game.phaseBeforePause
    delete game.pausedRemainingMs
    this.transition(room, next)
    this.scheduleCurrentPhase(room)
    this.emitRoom(room.id)
  }

  endEarly(playerId: string): void {
    const room = this.requireHostRoom(playerId)
    if (!this.isPlaying(room.phase) && room.phase !== 'paused')
      throw new GameError('INVALID_PHASE', '当前没有可提前结束的比赛')
    this.finishGame(room, '房主提前结束了本局游戏')
  }

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
    this.emitToPlayer(targetId, EVENTS.roomClosed, { reason: '你已被房主移出房间' })
    this.leaveRoom(targetId, '玩家被房主移出')
  }

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
    if (room.phase !== 'waiting' || room.members.length >= room.settings.maxPlayers)
      throw new GameError('ROOM_NOT_JOINABLE', '房间已开始或已满员，不能邀请')
    if (room.hostId !== playerId && !room.settings.allowPlayerInvite)
      throw new GameError('FORBIDDEN', '本房间仅房主可以邀请')
    if (!target.connected || target.roomId || !target.preferences.acceptsInvites)
      throw new GameError('TARGET_UNAVAILABLE', '该玩家当前无法接收邀请')
    const last = sender.lastInviteAt.get(targetId) ?? 0
    if (Date.now() - last < APP_CONFIG.network.inviteCooldownMs)
      throw new GameError('RATE_LIMITED', '邀请发送过于频繁，请稍后再试')
    sender.lastInviteAt.set(targetId, Date.now())
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
    if (!invite || invite.toPlayerId !== playerId || invite.expiresAt < Date.now())
      throw new GameError('INVITE_EXPIRED', '邀请已失效，请让对方重新邀请')
    const room = this.rooms.get(invite.roomId)
    this.resolveInvite(inviteId, accept ? 'accepted' : 'declined')
    if (!accept) return undefined
    if (!room) throw new GameError('ROOM_NOT_FOUND', '受邀房间已经关闭')
    return this.joinRoom(playerId, room.id)
  }

  handleDisconnect(socket: Socket): void {
    const playerId = socket.data.playerId as string | undefined
    if (!playerId) return
    const player = this.players.get(playerId)
    if (!player || player.socketId !== socket.id) return
    player.connected = false
    this.logger.info({ playerId, roomId: player.roomId }, '玩家连接已断开并进入恢复宽限')
    player.socket = undefined
    player.socketId = undefined
    player.disconnectedAt = Date.now()
    const room = player.roomId ? this.rooms.get(player.roomId) : undefined
    if (room?.phase === 'starting') this.setWaiting(room, '有玩家掉线，开始倒计时已取消')
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
          const candidate = room.members.find(
            (member) =>
              member.playerId !== playerId && this.players.get(member.playerId)?.connected,
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
    player.disconnectTimer = setTimeout(
      () => this.expireDisconnectedPlayer(playerId),
      APP_CONFIG.network.reconnectGraceMs,
    )
    this.emitRoom(player.roomId)
    this.broadcastPresence()
  }

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

  snapshotForPlayer(playerId: string): RoomSnapshot | undefined {
    const player = this.players.get(playerId)
    const room = player?.roomId ? this.rooms.get(player.roomId) : undefined
    return room ? this.snapshotRoom(room, playerId) : undefined
  }

  private beginGame(room: RoomSecret): void {
    if (room.game?.timer) clearTimeout(room.game.timer)
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
    if (game.currentRound > game.totalRounds) {
      this.finishGame(room, '全部回合完成')
      return
    }
    const drawer = this.findNextDrawer(room, game)
    if (!drawer) {
      this.finishGame(room, '没有可继续作画的在线玩家')
      return
    }
    this.transition(room, 'choosing_word')
    game.drawerId = drawer
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
    game.usedWordIds.add(answer.id)
    game.phaseStartedAt = Date.now()
    game.phaseEndsAt = Date.now() + room.settings.drawSeconds * 1_000
    game.timer = setTimeout(() => this.finishRound(room, false), room.settings.drawSeconds * 1_000)
    this.scheduleHints(room)
    this.addSystemNotice(room, '作画开始，猜词玩家请在右侧输入答案')
    this.emitRoom(room.id)
  }

  private markCorrect(room: RoomSecret, member: MemberState): void {
    const game = this.requireGame(room)
    if (member.guessedAt) return
    member.guessedAt = Date.now()
    game.correctOrder.push(member.playerId)
    const detail = calculateGuessScore({
      elapsedMs: member.guessedAt - game.phaseStartedAt,
      durationMs: room.settings.drawSeconds * 1_000,
      correctOrder: game.correctOrder.length,
      playerCount: room.members.length,
      base: APP_CONFIG.game.score.guessBase,
      maxSpeedBonus: APP_CONFIG.game.score.maxSpeedBonus,
      orderBonuses: APP_CONFIG.game.score.orderBonuses,
    })
    member.score += detail.total
    member.stats.correctCount += 1
    member.stats.totalGuessMs += member.guessedAt - game.phaseStartedAt
    this.addMessage(room, {
      type: 'correct',
      text: `${this.players.get(member.playerId)?.profile.nickname ?? '玩家'} 猜中了！`,
      playerId: member.playerId,
    })
    this.io
      .to(room.id)
      .emit(EVENTS.guessCorrect, { playerId: member.playerId, order: game.correctOrder.length })
    const eligible = room.members.filter(
      (candidate) =>
        candidate.playerId !== game.drawerId && this.players.get(candidate.playerId)?.connected,
    )
    if (eligible.length > 0 && eligible.every((candidate) => candidate.guessedAt))
      this.finishRound(room, false)
    else this.emitRoom(room.id)
  }

  private finishRound(room: RoomSecret, drawerAbandoned: boolean): void {
    const game = room.game
    if (!game || !game.answer || !['drawing', 'paused'].includes(room.phase)) return
    this.clearHintTimers(game)
    if (game.timer) clearTimeout(game.timer)
    if (room.phase === 'paused') room.phase = 'drawing'
    this.transition(room, 'round_result')
    const details = game.correctOrder.map((playerId, index) => {
      const member = room.members.find((candidate) => candidate.playerId === playerId)
      const guessedAt = member?.guessedAt ?? game.phaseEndsAt
      return {
        playerId,
        ...calculateGuessScore({
          elapsedMs: guessedAt - game.phaseStartedAt,
          durationMs: room.settings.drawSeconds * 1_000,
          correctOrder: index + 1,
          playerCount: room.members.length,
          base: APP_CONFIG.game.score.guessBase,
          maxSpeedBonus: APP_CONFIG.game.score.maxSpeedBonus,
          orderBonuses: APP_CONFIG.game.score.orderBonuses,
        }),
      }
    })
    const allGuessers = room.members.filter(
      (member) => member.playerId !== game.drawerId && this.players.get(member.playerId)?.connected,
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
    if (room.phase === 'paused') room.phase = game.phaseBeforePause ?? 'drawing'
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
    if (!this.isPlaying(room.phase) || room.phase === 'paused') return
    const game = this.requireGame(room)
    this.clearHintTimers(game)
    if (game.timer) clearTimeout(game.timer)
    game.phaseBeforePause = room.phase
    game.pausedRemainingMs = Math.max(0, game.phaseEndsAt - Date.now())
    this.transition(room, 'paused')
    game.phaseEndsAt = 0
    this.addSystemNotice(room, reason)
  }

  private scheduleCurrentPhase(room: RoomSecret): void {
    const game = this.requireGame(room)
    const delay = Math.max(0, game.phaseEndsAt - Date.now())
    if (game.timer) clearTimeout(game.timer)
    if (room.phase === 'choosing_word') {
      game.timer = setTimeout(() => {
        const candidate = game.candidates[0]
        if (candidate) this.beginDrawing(room, candidate)
      }, delay)
    } else if (room.phase === 'drawing') {
      game.timer = setTimeout(() => this.finishRound(room, false), delay)
      this.scheduleHints(room)
    } else if (room.phase === 'round_result')
      game.timer = setTimeout(() => this.beginChoosing(room), delay)
  }

  private setWaiting(room: RoomSecret, notice: string): void {
    if (room.game) this.clearHintTimers(room.game)
    if (room.game?.timer) clearTimeout(room.game.timer)
    delete room.game
    room.phase = 'waiting'
    this.invalidateReady(room, notice)
    this.emitRoom(room.id)
  }

  private transition(room: RoomSecret, next: RoomPhase): void {
    if (!canTransition(room.phase, next))
      throw new GameError('INVALID_TRANSITION', `非法状态转换：${room.phase} → ${next}`)
    const previous = room.phase
    room.phase = next
    this.logger.info({ roomId: room.id, from: previous, to: next }, '房间阶段已转换')
    room.stateVersion += 1
  }

  private snapshotRoom(room: RoomSecret, viewerId: string): RoomSnapshot {
    const game = room.game
    const viewerIsDrawer = game?.drawerId === viewerId
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
          answerMask: game.answer
            ? room.phase === 'round_result' || room.phase === 'game_result'
              ? game.answer.text
              : room.settings.showWordLength
                ? createAnswerMask(game.answer.text, game.revealedIndices)
                : '答案长度已隐藏'
            : '',
          ...(viewerIsDrawer && game.answer ? { answer: game.answer.text } : {}),
          ...(viewerIsDrawer && room.phase === 'choosing_word'
            ? { wordOptions: game.candidates.map((word) => ({ id: word.id, text: word.text })) }
            : {}),
          strokes: game.strokes,
          undoneStrokeIds: game.undoneStrokeIds,
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
      members: room.members.map((member) => {
        const player = this.requirePlayer(member.playerId)
        return {
          ...this.toPublicPlayer(player),
          ready: member.ready,
          score: member.score,
          isHost: room.hostId === member.playerId,
          isDrawer: game?.drawerId === member.playerId,
          guessed: Boolean(member.guessedAt),
          connection: player.connected ? 'online' : 'reconnecting',
          stats: member.stats,
        }
      }),
      selectedWordCount: room.selectedWordIds.size,
      totalWordCount: this.vocabulary.items.length,
      ...(gameView ? { game: gameView } : {}),
    }
  }

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
    return {
      id: room.id,
      name: room.name,
      hostName: this.players.get(room.hostId)?.profile.nickname ?? '未知房主',
      playerCount: room.members.length,
      maxPlayers: room.settings.maxPlayers,
      phase: room.phase,
      roundsPerPlayer: room.settings.roundsPerPlayer,
      drawSeconds: room.settings.drawSeconds,
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
    const invite = this.invites.get(id)
    if (!invite) return
    clearTimeout(invite.timer)
    this.invites.delete(id)
    const payload = { id, status }
    this.emitToPlayer(invite.fromPlayerId, EVENTS.inviteResolved, payload)
    this.emitToPlayer(invite.toPlayerId, EVENTS.inviteResolved, payload)
  }

  private expireDisconnectedPlayer(playerId: string): void {
    const player = this.players.get(playerId)
    if (!player || player.connected) return
    if (player.roomId) this.leaveRoom(playerId, '玩家重连超时离开')
    this.players.delete(player.id)
    this.playersByToken.delete(player.token)
    this.broadcastPresence()
  }

  private closeRoom(room: RoomSecret, reason: string): void {
    if (room.game) this.clearHintTimers(room.game)
    if (room.game?.timer) clearTimeout(room.game.timer)
    room.phase = 'closed'
    this.io.to(room.id).emit(EVENTS.roomClosed, { reason })
    this.rooms.delete(room.id)
    this.broadcastPresence()
  }

  private transferHostInternal(room: RoomSecret): void {
    const candidate =
      room.members.find((member) => this.players.get(member.playerId)?.connected) ?? room.members[0]
    if (!candidate) return
    room.hostId = candidate.playerId
    this.addSystemNotice(
      room,
      `房主已迁移给 ${this.players.get(candidate.playerId)?.profile.nickname ?? '新房主'}`,
    )
  }

  private invalidateReady(room: RoomSecret, notice: string): void {
    room.members.forEach((member) => (member.ready = false))
    room.stateVersion += 1
    this.addSystemNotice(room, notice)
  }

  private addMessage(room: RoomSecret, input: Omit<ChatMessage, 'id' | 'createdAt'>): void {
    const game = this.requireGame(room)
    game.messages.push({ ...input, id: randomUUID(), createdAt: Date.now() })
    game.messages = game.messages.slice(-APP_CONFIG.ui.recentMessageCount * 2)
  }

  private addSystemNotice(room: RoomSecret, text: string): void {
    if (room.game) this.addMessage(room, { type: 'system', text })
    this.io.to(room.id).emit(EVENTS.systemNotice, { text })
  }

  /**
   * 按剩余时间阈值安排提示。每次只揭示一个非标点字符，且至少保留一个字符未知，
   * 因此提示只缩小范围而不会直接泄露答案。
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
    const candidates = Array.from(game.answer.text)
      .map((character, index) => ({ character, index }))
      .filter(
        ({ character, index }) =>
          !/^[\p{P}\p{Z}\s]$/u.test(character) && !game.revealedIndices.has(index),
      )
    if (candidates.length <= 1) return
    const target = candidates[Math.floor(Math.random() * candidates.length)]
    if (target) game.revealedIndices.add(target.index)
    this.emitRoom(room.id)
  }

  private clearHintTimers(game: GameSecret): void {
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
    let pool = [...room.selectedWordIds]
      .filter((id) => !game.usedWordIds.has(id))
      .map((id) => this.vocabulary.byId.get(id))
      .filter((word) => word !== undefined)
    if (pool.length < room.settings.optionCount && APP_CONFIG.vocabulary.resetWhenExhausted) {
      game.usedWordIds.clear()
      pool = [...room.selectedWordIds]
        .map((id) => this.vocabulary.byId.get(id))
        .filter((word) => word !== undefined)
    }
    return this.shuffle(pool).slice(0, room.settings.optionCount)
  }

  private findNextDrawer(room: RoomSecret, game: GameSecret): string | undefined {
    const start = game.currentRound - 1
    for (let offset = 0; offset < game.drawerOrder.length; offset += 1) {
      const candidate = game.drawerOrder[(start + offset) % game.drawerOrder.length]
      if (
        candidate &&
        room.members.some((member) => member.playerId === candidate) &&
        this.players.get(candidate)?.connected
      )
        return candidate
    }
    return undefined
  }

  private createMember(player: PlayerSecret): MemberState {
    return {
      playerId: player.id,
      ready: false,
      score: 0,
      joinedAt: Date.now(),
      stats: { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 },
    }
  }

  private cleanNickname(value: string): string {
    const clean = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
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
    const occupied = new Set(
      [...this.players.values()]
        .filter((player) => player.id !== exceptId)
        .map((player) => normalizeAnswer(player.profile.nickname)),
    )
    if (!occupied.has(normalizeAnswer(value))) return value
    for (let suffix = 2; suffix <= 99; suffix += 1) {
      const base = Array.from(value)
        .slice(0, APP_CONFIG.player.nicknameMaxLength - String(suffix).length)
        .join('')
      const candidate = `${base}${suffix}`
      if (!occupied.has(normalizeAnswer(candidate))) return candidate
    }
    throw new GameError('DUPLICATE_NICKNAME', '昵称已被占用，请换一个昵称')
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
    if (!valid) throw new GameError('INVALID_SETTINGS', '房间规则超出服务器允许范围')
  }

  private requirePlayer(playerId: string): PlayerSecret {
    const player = this.players.get(playerId)
    if (!player) throw new GameError('UNAUTHORIZED', '身份已失效，请重新进入游戏')
    return player
  }

  private requireAvailablePlayer(playerId: string): PlayerSecret {
    const player = this.requirePlayer(playerId)
    if (player.roomId) throw new GameError('ALREADY_IN_ROOM', '你已经在一个房间中，请先退出')
    return player
  }

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

  private requireHostRoom(playerId: string): RoomSecret {
    const { room } = this.requireMembership(playerId)
    if (room.hostId !== playerId) throw new GameError('FORBIDDEN', '只有房主可以执行此操作')
    return room
  }

  private requireGame(room: RoomSecret): GameSecret {
    if (!room.game) throw new GameError('NO_GAME', '当前房间没有进行中的游戏')
    return room.game
  }

  private requireDrawerGame(room: RoomSecret, playerId: string, roundId: string): GameSecret {
    const game = this.requireGame(room)
    if (room.phase !== 'drawing' || game.drawerId !== playerId || game.roundId !== roundId)
      throw new GameError('NOT_DRAWER', '只有当前画家可以修改画板')
    return game
  }

  private onlineMemberCount(room: RoomSecret): number {
    return room.members.filter((member) => this.players.get(member.playerId)?.connected).length
  }

  private isPlaying(phase: RoomPhase): boolean {
    return ['starting', 'choosing_word', 'drawing', 'round_result'].includes(phase)
  }

  private joinSocketRoom(player: PlayerSecret): void {
    if (player.roomId) player.socket?.join(player.roomId)
  }

  private emitToPlayer(playerId: string, event: string, payload: unknown): void {
    this.players.get(playerId)?.socket?.emit(event, payload)
  }

  private shuffle<T>(values: T[]): T[] {
    const result = [...values]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1))
      ;[result[index], result[target]] = [result[target] as T, result[index] as T]
    }
    return result
  }
}
