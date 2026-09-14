import { RoomPersistenceCoordinator } from './application/room-persistence-coordinator.ts'
import { RoomMembershipService } from './domain/room/room-membership-service.ts'
import { SessionService } from './domain/session/session-service.ts'
import { selectDiverseCandidates } from './domain/vocabulary/candidate-selector.ts'
/**
 * 服务端权威游戏服务。
 *
 * 本类独占所有可改变比赛结果的状态：身份、成员资格、准备、阶段、答案、计时、绘图与分数。
 * Socket 处理器只负责校验载荷并调用这些方法，客户端永远不能上传裁决结果。
 */
import {
  EVENTS,
  MIN_SELECTED_VOCABULARY_WORDS,
  canTransition,
  createServerPush,
  normalizeAnswer,
  type ChatMessage,
  type FillCommand,
  type Invite,
  type PresenceSnapshot,
  type Profile,
  type PublicPlayer,
  type RoomPhase,
  type RoomSettings,
  type RoomSnapshot,
  type RoomVisibility,
  type SessionRegistration,
  type Stroke,
  type StrokeAck,
  type VocabularySnapshot,
  type VocabularyWord,
} from '@draw-guess/shared'
import type { Server, Socket } from 'socket.io'
import { APP_CONFIG } from './config/index.ts'
import { createRoomSettings } from '@draw-guess/config'
import { serverStrings } from '@draw-guess/strings'
import { RoomPublisher } from './application/room-publisher.ts'
import { DomainContext } from './domain/domain-context.ts'
import { DrawingService } from './domain/drawing/drawing-service.ts'
import { InviteService } from './domain/invite/invite-service.ts'
import { RoomVocabularyService } from './domain/vocabulary/room-vocabulary-service.ts'
import {
  GameError,
  SILENT_LOGGER,
  type RuntimeLogContext,
  type RuntimeLogger,
  runtimeErrorType,
} from './errors.ts'
import type { GameSecret, MemberState, PlayerSecret, RoomSecret } from './models.ts'
import { enforceEventRate } from './rate-limit.ts'
import type { ArchiveRepository, PlayerRepository } from './repositories/index.ts'
import { validateRoomSettings } from './room-settings.ts'
import { RoundMachine } from './round-machine.ts'
import { SYSTEM_RUNTIME, type RuntimeDependencies } from './runtime.ts'
import { SnapshotBuilder } from './snapshot.ts'
import type { VocabularyRegistry, VocabularyStore } from './vocabulary/index.ts'
import { OperationalMetrics } from './observability/metrics.ts'

/** 默认房间规则只从根级配置生成，避免处理器中出现另一套默认值。 */
export function createDefaultRoomSettings(): RoomSettings {
  return createRoomSettings('standard', APP_CONFIG.player.defaultMaxPlayers)
}

/**
 * 计时器全部保存在房间秘密状态中。每次切换阶段前清理旧计时器，可阻止旧回调在新回合中误执行。
 */
export class GameService {
  readonly session: SessionService
  readonly membership: RoomMembershipService
  readonly persistence: RoomPersistenceCoordinator
  readonly domain = new DomainContext()
  readonly players = this.domain.players
  readonly playersByTokenDigest = this.domain.playersByTokenDigest
  readonly rooms = this.domain.rooms
  /** 私密房间码到内部 UUID 的内存索引；房间关闭后立即回收。 */
  readonly roomsByPrivateCode = this.domain.roomsByPrivateCode
  readonly invites = this.domain.invites

  /** 回合流转状态机：开局/选词/作画/结算/暂停等阶段推进逻辑。 */
  readonly round: RoundMachine
  /** 视图裁剪（快照组装）构建器。 */
  readonly snapshotter: SnapshotBuilder
  /** 绘图命令用例协作者；GameService 保留兼容委托入口。 */
  readonly drawing: DrawingService
  readonly invitation: InviteService
  readonly roomVocabulary: RoomVocabularyService
  readonly publisher: RoomPublisher

  constructor(
    readonly io: Server,
    readonly vocabulary: VocabularyRegistry,
    /** 持久化仓储（短期身份/完成局战报），由启动器注入 SQLite 实现。 */
    readonly repositories: {
      players: PlayerRepository
      archive: ArchiveRepository
    },
    readonly logger: RuntimeLogger = SILENT_LOGGER,
    readonly runtime: RuntimeDependencies = SYSTEM_RUNTIME,
    readonly metrics: OperationalMetrics = new OperationalMetrics(),
  ) {
    this.session = new SessionService({
      broadcastPresence: (...args) => this.broadcastPresence(...args),
      clock: this.clock,
      emitRoom: (...args) => this.emitRoom(...args),
      emitRoomEvent: (roomId, event, payload) => this.io.to(roomId).emit(event, payload),
      finishRound: (...args) => this.round.finishRound(...args),
      leaveRoom: (...args) => this.leaveRoom(...args),
      logger: this.logger,
      persistPlayer: (player) => this.persistence.persistPlayer(player),
      players: this.players,
      playersByTokenDigest: this.playersByTokenDigest,
      random: this.random,
      repositories: this.repositories,
      requirePlayer: (...args) => this.requirePlayer(...args),
      rooms: this.rooms,
      transferDisconnectedHost: (room, playerId) =>
        this.membership.transferDisconnectedHost(room, playerId),
      safeRun: (...args) => this.safeRun(...args),
      scheduler: this.scheduler,
      toPublicPlayer: (player) => this.snapshotter.toPublicPlayer(player),
    })
    this.membership = new RoomMembershipService({
      abandonChoosing: (...args) => this.round.abandonChoosing(...args),
      addSystemNotice: (...args) => this.addSystemNotice(...args),
      broadcastPresence: (...args) => this.broadcastPresence(...args),
      clearHintTimers: (...args) => this.clearHintTimers(...args),
      clock: this.clock,
      emitRoom: (...args) => this.emitRoom(...args),
      emitRoomEvent: (roomId, event, payload) => this.io.to(roomId).emit(event, payload),
      emitToPlayer: (...args) => this.emitToPlayer(...args),
      evaluateRematch: (...args) => this.round.evaluateRematch(...args),
      finishRound: (...args) => this.round.finishRound(...args),
      getRoomVocabularyStore: (...args) => this.getRoomVocabularyStore(...args),
      isPlaying: (...args) => this.isPlaying(...args),
      logger: this.logger,
      pauseRoomInternal: (...args) => this.round.pauseRoomInternal(...args),
      players: this.players,
      random: this.random,
      requirePlayer: (...args) => this.requirePlayer(...args),
      rooms: this.rooms,
      roomsByPrivateCode: this.roomsByPrivateCode,
      scheduler: this.scheduler,
      setWaiting: (...args) => this.round.setWaiting(...args),
      snapshot: (room, playerId) => this.snapshotter.snapshot(room, playerId),
      transition: (...args) => this.transition(...args),
      validateSettings: (...args) => this.validateSettings(...args),
      vocabulary: this.vocabulary,
    })
    this.persistence = new RoomPersistenceCoordinator({
      clock: this.clock,
      repositories: this.repositories,
    })
    this.round = new RoundMachine(this)
    this.snapshotter = new SnapshotBuilder(this)
    this.publisher = new RoomPublisher({
      io: this.io,
      rooms: this.rooms,
      players: this.players,
      snapshot: (room, viewerId) => this.snapshotter.snapshot(room, viewerId),
      toPublicPlayer: (player) => this.snapshotter.toPublicPlayer(player),
      toPublicRoom: (room) => this.snapshotter.toPublicRoom(room),
      logError: (error, context) => this.logUnexpectedError(error, context),
    })
    this.drawing = new DrawingService({
      clock: this.clock,
      getSession: (playerId, roundId) => this.getDrawingSession(playerId, roundId),
      emitRoom: (roomId) => this.emitRoom(roomId),
      publishStroke: (payload) =>
        this.io.to(payload.roomId).emit(EVENTS.drawStrokeBatch, createServerPush(payload)),
      publishFill: (payload) =>
        this.io.to(payload.roomId).emit(EVENTS.drawFillCommit, createServerPush(payload)),
    })
    this.invitation = new InviteService({
      invites: this.invites,
      clock: this.clock,
      scheduler: this.scheduler,
      random: this.random,
      getMembership: (playerId) => this.requireMembership(playerId),
      getPlayer: (playerId) => this.requirePlayer(playerId),
      getRoom: (roomId) => this.rooms.get(roomId),
      join: (playerId, room) =>
        this.membership.joinResolvedRoom(
          this.membership.requireAvailablePlayer(playerId),
          room,
          'invite',
        ),
      toPublicInvite: (invite) => this.snapshotter.toPublicInvite(invite),
      emitInvite: (target, invite) =>
        target.socket?.emit(EVENTS.inviteReceived, createServerPush(invite)),
      emitResolved: (invite, id, status) => {
        const payload = createServerPush({ id, status })
        this.emitToPlayer(invite.fromPlayerId, EVENTS.inviteResolved, payload)
        this.emitToPlayer(invite.toPlayerId, EVENTS.inviteResolved, payload)
      },
      safeRun: (label, action) => this.safeRun(label, action),
    })
    this.roomVocabulary = new RoomVocabularyService({
      registry: this.vocabulary,
      getMembership: (playerId) => this.requireMembership(playerId),
      getHostRoom: (playerId) => this.requireHostRoom(playerId),
      getStore: (room) => this.getRoomVocabularyStore(room),
      addNotice: (room, text) => this.addSystemNotice(room, text),
      emitRoom: (roomId) => this.emitRoom(roomId),
    })
  }

  /** 兼容领域协作者的简洁访问，同时确保全部时间来自统一运行时。 */
  get clock(): RuntimeDependencies['clock'] {
    return this.runtime.clock
  }

  get scheduler(): RuntimeDependencies['scheduler'] {
    return this.runtime.scheduler
  }

  get random(): RuntimeDependencies['random'] {
    return this.runtime.random
  }

  /** 获取房间当前绑定的词库 Store（若未绑定或未找到则回退默认词库）。 */
  getRoomVocabularyStore(room?: RoomSecret): VocabularyStore {
    if (room?.vocabularyPackageId && 'get' in this.vocabulary) {
      const store = this.vocabulary.get(room.vocabularyPackageId)
      if (store) return store
    }
    return 'getDefault' in this.vocabulary ? this.vocabulary.getDefault() : this.vocabulary
  }

  /** 记录未预期的服务器内部错误（脱敏到错误名），供排查 bindRequest 兜底返回的 INTERNAL_ERROR。 */
  logUnexpectedError(error: unknown, context: RuntimeLogContext = {}): void {
    this.logger.error(
      {
        ...context,
        errorType: runtimeErrorType(error),
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
  ): Omit<SessionRegistration, 'room'> {
    return this.session.register(socket, input)
  }

  /**
   * 把整局战报落盘：game_archive（一成行，冻结最终排名）+ game_results（逐玩家结果）。
   * 在 finishGame（进入 game_result）时由 RoundMachine 调用。
   * 数据直接取用结算瞬间冻结的 finalRanking（同分并列、成员中途离房不影响），保证与展示一致。
   * rounds 表为将来回合级回放预留，本期不采集（见 db/migrate.ts 与 archive 仓储注释）。
   */
  public persistGameResult(room: RoomSecret, reason: string): void {
    return this.persistence.persistGameResult(room, reason)
  }

  /**
   * 启动恢复（服务重启时调用）：
   * - 全部持久化玩家标记为断线（connected=0，disconnected_at=now），身份与恢复令牌保留，
   *   客户端重启后仍可凭令牌在宽限期内恢复到同一 UUID；
   * - 房间没有持久化记录，进程重启后自然回到空大厅。
   * 这样不会出现「重启后房间仍在库但无人可接管」的僵尸状态。
   */
  recoverOnStartup(): void {
    return this.session.recoverOnStartup()
  }

  /**
   * 玩家主动注销会话：解除 Socket 绑定、清理房间归属、移除内存与数据库记录。
   * 确保清除本地资料后，无需刷新页面即可在同一连接上注册为全新身份。
   */
  logout(socket: Socket): void {
    return this.session.logout(socket)
  }

  updateProfile(playerId: string, profile: Profile): PublicPlayer {
    return this.session.updateProfile(playerId, profile)
  }

  /** 更新发现/邀请偏好并广播大厅快照（影响是否出现在发现列表中）。 */
  updatePreferences(
    playerId: string,
    preferences: { discoverable: boolean; acceptsInvites: boolean },
  ): void {
    return this.session.updatePreferences(playerId, preferences)
  }

  createRoom(
    playerId: string,
    input: { name: string; visibility: RoomVisibility; settings: RoomSettings },
  ): RoomSnapshot {
    return this.membership.createRoom(playerId, input)
  }

  /** 通过大厅内部 UUID 加入公开房；私密房 UUID 即使被猜到也按不存在处理。 */
  joinRoom(playerId: string, roomId: string): RoomSnapshot {
    return this.membership.joinRoom(playerId, roomId)
  }

  /** 通过短码加入私密房；独立限频防止在局域网内高频枚举房间码。 */
  joinPrivateRoom(playerId: string, code: string): RoomSnapshot {
    return this.membership.joinPrivateRoom(playerId, code)
  }

  leaveRoom(playerId: string, reason: string = serverStrings.notices.leaveReasonDefault): void {
    return this.membership.leaveRoom(playerId, reason)
  }

  /**
   * 主动退出当前对局：玩家立即回到大厅，但本局保留一张冻结资料的灰色成绩卡。
   * 该成员不再参与画家轮换、计分、在线人数或房主迁移，也不再接收旧房间快照。
   */
  leaveGame(playerId: string): void {
    return this.membership.leaveGame(playerId)
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
    // 最大人数不能小于当前活跃成员数，否则会出现超员
    const activeMembers = room.members.filter((member) => !member.leftGame)
    if (next.maxPlayers < activeMembers.length)
      throw new GameError('INVALID_SETTINGS', serverStrings.errors.INVALID_SETTINGS_MAX_PLAYERS)
    room.settings = next
    if (room.phase === 'waiting') {
      room.members.forEach((member, index) => {
        member.seatIndex = index
      })
    }
    this.invalidateReady(room, serverStrings.notices.rulesUpdated)
    this.emitRoom(room.id)
    // maxPlayers 会显示在大厅房间行中，规则变更后需同步广播大厅快照，避免列表展示陈旧人数。
    this.broadcastPresence()
    return this.snapshotter.snapshot(room, playerId)
  }

  /**
   * 读取本局词库快照（当前包 ID、全部可用词库包、词条列表、当前选择、词库版本与分类白名单）。
   * 房主与普通成员都可读（普通成员只能查看，不能修改；修改与切换仅房主）。
   */
  getVocabulary(playerId: string): VocabularySnapshot {
    return this.roomVocabulary.get(playerId)
  }

  /**
   * 房主切换房间词库包（默认选择词数最多的词库；亦可在词库管理中自由切换）。
   * 切换后重置为新词库全部词条，自增房间状态版本并推送快照与系统通知。
   */
  selectVocabularyPackage(
    playerId: string,
    packageId: string,
    expectedVersion?: number,
  ): VocabularySnapshot {
    return this.roomVocabulary.selectPackage(playerId, packageId, expectedVersion)
  }

  updateVocabulary(playerId: string, ids: string[], expectedVersion: number): VocabularySnapshot {
    return this.roomVocabulary.update(playerId, ids, expectedVersion)
  }

  startGame(playerId: string, expectedVersion: number): RoomSnapshot {
    const room = this.requireHostRoom(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_GAME_STARTED)
    if (room.stateVersion !== expectedVersion)
      throw new GameError('VERSION_CONFLICT', serverStrings.errors.VERSION_CONFLICT_START)
    // 开局硬性门槛：至少 2 名可玩成员且全部在线；只有非房主成员需要显式准备。
    const activeMembers = room.members.filter((member) => !member.spectating && !member.leftGame)
    if (activeMembers.length < APP_CONFIG.player.minPlayers)
      throw new GameError('NOT_ENOUGH_PLAYERS', serverStrings.errors.NOT_ENOUGH_PLAYERS)
    const allOnline = activeMembers.every((member) => this.players.get(member.playerId)?.connected)
    const guestsReady = activeMembers
      .filter((member) => member.playerId !== room.hostId)
      .every((member) => member.ready)
    if (!allOnline || !guestsReady)
      throw new GameError('NOT_ALL_READY', serverStrings.errors.NOT_ALL_READY)
    // 本局词条数必须不少于最小词数（60条）且覆盖选词候选数
    const requiredWords = Math.max(MIN_SELECTED_VOCABULARY_WORDS, room.settings.optionCount)
    if (room.selectedWordIds.size < requiredWords) {
      throw new GameError(
        'VOCABULARY_TOO_SMALL',
        serverStrings.errors.VOCABULARY_TOO_SMALL_GAME(requiredWords),
      )
    }

    // 进入 3 秒开始倒计时阶段；倒计时结束而且阶段未变时正式开局
    this.transition(room, 'starting')
    const gameId = this.random.uuid()
    const timer = this.scheduler.set(APP_CONFIG.game.startingCountdownSeconds * 1_000, () =>
      this.safeRun('startingCountdown', () => {
        if (room.phase !== 'starting' || room.game?.id !== gameId) return
        this.round.beginGame(room)
      }),
    )
    // 预建本局秘密状态：洗牌确定画家顺序（只含可玩成员），清空所有历史与计时
    room.game = {
      id: gameId,
      startedAt: this.clock.now(),
      roundId: '',
      phaseStartedAt: this.clock.now(),
      phaseEndsAt: this.clock.now() + APP_CONFIG.game.startingCountdownSeconds * 1_000,
      currentRound: 0,
      totalRounds: activeMembers.length * room.settings.roundsPerPlayer,
      roundDurationMs: room.settings.drawSeconds * 1_000, // 开局默认房间时长；每回合 beginDrawing 按词条时限刷新
      drawerOrder: this.shuffle(activeMembers.map((member) => member.playerId)),
      drawerId: '',
      candidates: [],
      offeredWordIds: new Set(),
      strokes: [],
      strokePointTotal: 0,
      fillCount: 0,
      undoneStrokeIds: [],
      lastSequence: -1,
      drawingRevision: 0,
      messages: [],
      correctOrder: [],
      correctDetails: [],
      revealedIndices: new Set(),
      hintOrder: [],
      revealedHintCount: 0,
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
    if (game.phaseEndsAt > 0 && this.clock.now() >= game.phaseEndsAt) {
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    }
    const answer = game.candidates.find((word) => word.id === wordId)
    if (!answer) throw new GameError('INVALID_WORD_ID', serverStrings.errors.INVALID_WORD_ID_CHOOSE)
    this.round.beginDrawing(room, answer)
  }

  /** 画家在选词阶段更换一组候选词（每回合最多允许一次） */
  rerollWordOptions(playerId: string, roundId: string): void {
    const { room } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    if (room.phase !== 'choosing_word' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER_CHOOSE)
    }
    if (game.phaseEndsAt > 0 && this.clock.now() >= game.phaseEndsAt) {
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    }
    if (!room.settings.allowWordReroll) {
      throw new GameError('REROLL_DISABLED', serverStrings.errors.REROLL_DISABLED)
    }
    if (game.rerollUsed) {
      throw new GameError('REROLL_ALREADY_USED', serverStrings.errors.REROLL_ALREADY_USED)
    }

    // 重新抽取候选词（pickCandidates 会从未展示词池抽取、按多样性分布并记录进 offeredWordIds）
    game.candidates = this.pickCandidates(room, game)
    game.rerollUsed = true
    this.emitRoom(room.id)
  }

  submitGuess(playerId: string, roundId: string, rawText: string): { correct: boolean } {
    const { room, member } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    // 仅作画阶段可猜词，且必须在当前回合，且答案已确定；观战者不能猜词
    if (room.phase !== 'drawing' || game.roundId !== roundId || !game.answer)
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_GUESS)
    if (game.phaseEndsAt > 0 && this.clock.now() >= game.phaseEndsAt)
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    if (game.drawerId === playerId)
      throw new GameError('DRAWER_CANNOT_GUESS', serverStrings.errors.DRAWER_CANNOT_GUESS)
    if (member.spectating)
      throw new GameError('SPECTATOR_CANNOT_GUESS', serverStrings.errors.SPECTATOR_CANNOT_GUESS)
    if (member.guessedAt)
      throw new GameError('ALREADY_GUESSED', serverStrings.errors.ALREADY_GUESSED)
    const text = rawText.trim()
    enforceEventRate(this.requirePlayer(playerId), 'guess', this.clock) // 猜词限频
    if (!text || Array.from(text).length > APP_CONFIG.player.chatMaxLength)
      throw new GameError('INVALID_MESSAGE', serverStrings.errors.INVALID_MESSAGE_EMPTY)
    const normalized = normalizeAnswer(text)
    const answer = normalizeAnswer(game.answer.text)
    // 命中正确答案：词面与全部别称均可判对（规范化后比较）
    const acceptedAnswers = [answer, ...game.answer.aliases.map((alias) => normalizeAnswer(alias))]
    if (acceptedAnswers.includes(normalized)) {
      // markCorrect 内部已负责广播（全员猜中时 finishRound，否则刷新快照），无需再重复广播
      this.round.markCorrect(room, member)
      return { correct: true }
    }
    // 未命中正确答案：作为普通猜词进入聊天流并广播全员（不提供近似词提示）
    this.addMessage(room, { type: 'guess', text, playerId })
    this.emitRoom(room.id)
    return { correct: false }
  }

  sendPreset(playerId: string, roundId: string, preset: string): void {
    const { room, member } = this.requireMembership(playerId)
    const game = this.requireGame(room)
    // 预设短语只能在作画阶段发送，且必须是配置白名单内的内容；观战者不能发送
    if (room.phase !== 'drawing' || game.roundId !== roundId)
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_PRESET)
    if (member.spectating)
      throw new GameError('SPECTATOR_CANNOT_CHAT', serverStrings.errors.SPECTATOR_CANNOT_CHAT)
    const allowedPresets: readonly string[] = [
      ...APP_CONFIG.presets.safeChat,
      ...APP_CONFIG.presets.chatReactions,
    ]
    if (!allowedPresets.includes(preset))
      throw new GameError('INVALID_MESSAGE', serverStrings.errors.INVALID_MESSAGE_PRESET)
    this.addMessage(room, { type: 'preset', text: preset, playerId })
    this.emitRoom(room.id)
  }

  addStroke(playerId: string, roundId: string, stroke: Stroke): StrokeAck {
    return this.drawing.addStroke(playerId, roundId, stroke)
  }

  /** 校验并提交封闭区域填充命令；客户端只上传点击位置和颜色，不上传像素数据。 */
  addFill(playerId: string, roundId: string, fill: FillCommand): { drawingRevision: number } {
    return this.drawing.addFill(playerId, roundId, fill)
  }

  undo(playerId: string, roundId: string): void {
    this.drawing.undo(playerId, roundId)
  }

  redo(playerId: string, roundId: string): void {
    this.drawing.redo(playerId, roundId)
  }

  clearDrawing(playerId: string, roundId: string): void {
    this.drawing.clear(playerId, roundId)
  }

  pause(playerId: string, reason: string): void {
    const { room, player } = this.requireMembership(playerId)
    if (!room.settings.allowPause)
      throw new GameError('PAUSE_DISABLED', serverStrings.errors.PAUSE_DISABLED)
    // 不可暂停的阶段（如开局倒计时）直接拒绝，避免静默无效或破坏计时现场
    if (!this.isPausable(room.phase))
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_PAUSE)
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
    // 先校验目标阶段合法，再清理暂停现场：否则转换失败会丢失 phaseBeforePause，房间无法再次恢复
    if (!canTransition(room.phase, next))
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_RESUME)
    const remainingMs = game.pausedRemainingMs ?? 1_000
    const totalDurationMs =
      next === 'drawing'
        ? game.roundDurationMs
        : next === 'choosing_word'
          ? room.settings.chooseSeconds * 1_000
          : remainingMs
    const effectiveElapsedMs = Math.max(0, totalDurationMs - remainingMs)
    game.phaseStartedAt = this.clock.now() - effectiveElapsedMs
    game.phaseEndsAt = this.clock.now() + remainingMs
    delete game.phaseBeforePause
    delete game.pausedRemainingMs
    this.transition(room, next)
    this.round.scheduleCurrentPhase(room)
    this.emitRoom(room.id)
  }

  /** 房主提前结束比赛：仅对局进行中（不含开局倒计时，尚未正式开赛）或暂停时可触发，直接进入最终结算。 */
  endEarly(playerId: string): void {
    const room = this.requireHostRoom(playerId)
    // starting（3 秒开局倒计时）不算可提前结束的比赛：此时 game 已预建但没有进行中的回合，
    // 若放行会试图执行领域不允许的 starting → game_result 转换。
    const inProgress =
      (this.isPlaying(room.phase) && room.phase !== 'starting') || room.phase === 'paused'
    if (!inProgress)
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_END_EARLY)
    this.round.finishGame(room, serverStrings.notices.endEarlyByHost)
  }

  /** 最终结算再来一局入口：普通成员只登记个人意愿，房主请求由状态机在最短展示期后全局执行。 */
  returnWaiting(playerId: string): void {
    const { room, member } = this.requireMembership(playerId)
    this.round.requestRematch(room, member)
  }

  kick(playerId: string, targetId: string): void {
    return this.membership.kick(playerId, targetId)
  }

  /** 房主主动移交控制权（仅等待阶段）：目标必须是房间成员。 */
  transferHost(playerId: string, targetId: string): void {
    return this.membership.transferHost(playerId, targetId)
  }

  sendInvite(playerId: string, targetId: string): Invite {
    return this.invitation.send(playerId, targetId)
  }

  respondInvite(playerId: string, inviteId: string, accept: boolean): RoomSnapshot | undefined {
    return this.invitation.respond(playerId, inviteId, accept)
  }

  handleDisconnect(socket: Socket): void {
    return this.session.handleDisconnect(socket)
  }

  /**
   * 向房间所有成员推送各自的角色裁剪快照。
   * 每个成员看到的答案/候选词不同，因此必须以成员为观看者分别生成。
   */
  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public emitRoom(roomId?: string): void {
    this.publisher.emitRoom(roomId)
  }

  /**
   * 执行不得抛出到调用方的副作用（计时器回调、异步清理等）：
   * 这些位置没有 ack 可以承载错误，一旦抛出就是未捕获异常，会直接打断 Node 事件循环并丢失全部内存态。
   */
  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public safeRun(label: string, fn: () => void): void {
    try {
      fn()
    } catch (error) {
      this.logUnexpectedError(error, { scope: 'timer', label })
    }
  }

  /**
   * 在线玩家与公开房间列表同源广播；独立 room:listChanged 事件让大厅可明确订阅房间变化，
   * presence:snapshot 则继续承担初始全量同步和向后兼容。
   */
  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public broadcastPresence(): void {
    this.publisher.broadcastPresence()
  }

  /** 大厅在线状态快照：只包含可发现玩家与全部未关闭房间。 */
  presenceSnapshot(): PresenceSnapshot {
    return this.publisher.presenceSnapshot()
  }

  /** 取指定玩家的当前房间快照（用于断线恢复/重同步），不要求玩家在线。 */
  snapshotForPlayer(playerId: string, forceFull = false): RoomSnapshot | undefined {
    return this.publisher.snapshotForPlayer(playerId, forceFull)
  }

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

  /** @internal 内部协作接口 */
  public invalidateReady(
    room: RoomSecret,
    notice: string,
    versionMode: 'increment' | 'preserve' = 'increment',
  ): void {
    // 阶段转换已经递增版本时使用 preserve，保证一次原子状态发布只占一个版本号。
    room.members.forEach((member) => (member.ready = false))
    if (versionMode === 'increment') room.stateVersion += 1
    this.addSystemNotice(room, notice)
  }

  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public addMessage(room: RoomSecret, input: Omit<ChatMessage, 'id' | 'createdAt'>): void {
    const game = this.requireGame(room)
    game.messages.push({ ...input, id: this.random.uuid(), createdAt: this.clock.now() })
    // 消息只保留最近两倍展示数量，防止内存无限增长
    game.messages = game.messages.slice(-APP_CONFIG.ui.recentMessageCount * 2)
  }

  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public addSystemNotice(room: RoomSecret, text: string): void {
    // 系统通知同时进入消息历史和作为独立事件推送（即使尚无对局也能收到）
    if (room.game) this.addMessage(room, { type: 'system', text })
    this.io.to(room.id).emit(EVENTS.systemNotice, createServerPush({ text }))
  }

  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public clearHintTimers(game: GameSecret): void {
    // 清理全部逐步提示计时器，防止暂停/切换阶段后旧回调误触发
    for (const timer of game.hintTimers ?? []) this.scheduler.clear(timer)
    game.hintTimers = []
  }

  /**
   * 候选词多样性抽样算法：
   * 保证候选词集合在难度（1~5星阶梯）和类别（无重复分类）上均匀随机分布。
   */
  private sampleDiverseCandidates(pool: VocabularyWord[], count: number): VocabularyWord[] {
    const selected = selectDiverseCandidates({ pool: this.shuffle([...pool]), count })
    return pool.length <= count ? selected : this.shuffle(selected)
  }

  /** @internal 内部协作接口 */
  public pickCandidates(room: RoomSecret, game: GameSecret): VocabularyWord[] {
    const store = this.getRoomVocabularyStore(room)
    // 从本局已选词库中排除本局已展示过的候选词条（整局绝不重复）
    let pool = [...room.selectedWordIds]
      .filter((id) => !game.offeredWordIds.has(id))
      .map((id) => store.byId.get(id))
      .filter((word): word is VocabularyWord => word !== undefined)

    // 词池不足且配置允许时重置已展示记录，保证每回合候选充足
    if (pool.length < room.settings.optionCount && APP_CONFIG.vocabulary.resetWhenExhausted) {
      game.offeredWordIds.clear()
      pool = [...room.selectedWordIds]
        .map((id) => store.byId.get(id))
        .filter((word): word is VocabularyWord => word !== undefined)
    }

    const picked = this.sampleDiverseCandidates(pool, room.settings.optionCount)
    // 立即将展示给玩家的候选词记录进 offeredWordIds，整局绝不重复出现
    picked.forEach((word) => game.offeredWordIds.add(word.id))
    return picked
  }

  /** @internal 内部协作接口 */
  public findNextDrawer(room: RoomSecret, game: GameSecret): string | undefined {
    // 从当前回合序号起，按开局洗牌顺序寻找第一位仍在房间、在线的可玩成员任画家（观战者跳过）
    const start = game.currentRound - 1
    for (let offset = 0; offset < game.drawerOrder.length; offset += 1) {
      const candidate = game.drawerOrder[(start + offset) % game.drawerOrder.length]
      const member = room.members.find((item) => item.playerId === candidate)
      if (
        candidate &&
        member &&
        !member.spectating &&
        !member.leftGame &&
        this.players.get(candidate)?.connected
      )
        return candidate
    }
    return undefined
  }

  private validateSettings(settings: RoomSettings): void {
    validateRoomSettings(settings)
  }

  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public requirePlayer(playerId: string): PlayerSecret {
    const player = this.players.get(playerId)
    if (!player) throw new GameError('UNAUTHORIZED', serverStrings.errors.UNAUTHORIZED)
    return player
  }

  /** 取身份 + 房间 + 成员席位三合一；不在房间时抛 NOT_IN_ROOM。 */
  private requireMembership(playerId: string): {
    player: PlayerSecret
    room: RoomSecret
    member: MemberState
  } {
    return this.membership.requireMembership(playerId)
  }

  /** 取房间并要求调用者为房主，否则抛 FORBIDDEN。 */
  private requireHostRoom(playerId: string): RoomSecret {
    return this.membership.requireHostRoom(playerId)
  }

  /** @internal 绘图协作者的窄查询入口。 */
  public getDrawingSession(
    playerId: string,
    roundId: string,
  ): { player: PlayerSecret; room: RoomSecret; game: GameSecret } {
    const membership = this.requireMembership(playerId)
    return {
      ...membership,
      game: this.requireDrawerGame(membership.room, playerId, roundId),
    }
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
    if (game.phaseEndsAt > 0 && this.clock.now() >= game.phaseEndsAt)
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    return game
  }

  /** 是否为对局进行中的阶段（用于“是否已开赛”类判定）。 */
  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public isPlaying(phase: RoomPhase): boolean {
    return ['starting', 'choosing_word', 'drawing', 'round_result'].includes(phase)
  }

  /**
   * 是否允许暂停。开局倒计时（starting）不在 `LEGAL_PHASES` 的 `paused` 白名单内：
   * 若允许暂停会先清除倒计时再转换失败，使房间永久停在无人推进的 starting。
   */
  /** @internal 内部协作接口（RoundMachine / 模块间调用） */
  public isPausable(phase: RoomPhase): boolean {
    return ['choosing_word', 'drawing', 'round_result'].includes(phase)
  }

  /** 向指定玩家发送无 ack 的推送事件。 */
  private emitToPlayer(playerId: string, event: string, payload: unknown): void {
    this.players.get(playerId)?.socket?.emit(event, payload)
  }

  /** Fisher-Yates 洗牌：随机打乱数组并返回新数组（不改原数组）。 */
  /** @internal 内部协作接口（RoundMachine 结构化提示顺序洗牌等） */
  public shuffle<T>(values: T[]): T[] {
    const result = [...values]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = this.random.integer(index + 1)
      ;[result[index], result[target]] = [result[target] as T, result[index] as T]
    }
    return result
  }
}
