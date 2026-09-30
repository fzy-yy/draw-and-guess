/**
 * 服务端权威游戏服务。
 *
 * 本类独占所有可改变比赛结果的状态：身份、成员资格、准备、阶段、答案、计时、绘图与分数。
 * Socket 处理器只负责校验载荷并调用这些方法，客户端永远不能上传裁决结果。
 */
import { RoomPersistenceCoordinator } from './application/room-persistence-coordinator.ts'
import { RoomMembershipService } from './domain/room/room-membership-service.ts'
import { SessionService } from './domain/session/session-service.ts'
import {
  EVENTS,
  MIN_SELECTED_VOCABULARY_WORDS,
  createServerPush,
  normalizeAnswer,
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
} from '@draw-guess/shared'
import type { AppServer, AppSocket } from './socket-types.ts'
import type { ServerPushEnvelope, ServerPushEventName } from '@draw-guess/shared'
import { APP_CONFIG } from './config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import { RoomPublisher } from './application/room-publisher.ts'
import { DomainContext } from './domain/domain-context.ts'
import { DrawingService } from './domain/drawing/drawing-service.ts'
import { InviteService } from './domain/invite/invite-service.ts'
import { RoomVocabularyService } from './domain/vocabulary/room-vocabulary-service.ts'
import type { PlayerLookupPorts, RoomEventPorts, RuntimePorts } from './domain/shared-ports.ts'
import {
  activePlayers,
  createOnlineLookup,
  isOnlinePlayer,
  isPhaseExpired,
  occupiesSeat,
} from './domain/room/member-facts.ts'
import { isInMatchPhase } from './domain/room/phase-facts.ts'
import {
  GameError,
  SILENT_LOGGER,
  type RuntimeLogContext,
  type RuntimeLogger,
  runtimeErrorType,
} from './errors.ts'
import type { GameSecret, PlayerSecret, RoomSecret } from './models.ts'
import { enforceEventRate } from './rate-limit.ts'
import type { ArchiveRepository, PlayerRepository } from './repositories/index.ts'
import { RoundMachine } from './round-machine.ts'
import { SYSTEM_RUNTIME, type RuntimeDependencies } from './runtime.ts'
import { SnapshotBuilder } from './snapshot.ts'
import type { VocabularyRegistry, VocabularyStore } from './vocabulary/index.ts'
import { OperationalMetrics } from './observability/metrics.ts'

/**
 * 跨协作者能力出口集合：由 GameService 在装配时构造一次，RoundMachine 与全部子服务
 * 直接引用（而非 `(...args) => this.x(...args)` 的延迟投影——那种写法丢形参名，
 * 且端口的实际依赖在运行时是整份 GameService）。
 * 每个成员都是显式实现；被依赖对象由 constructor 的依赖驱动装配保证已就绪。
 */
interface ServicePorts {
  requirePlayer: (playerId: string) => PlayerSecret
  requireGame: (room: RoomSecret) => GameSecret
  getRoomVocabularyStore: (room?: RoomSecret) => VocabularyStore
  safeRun: (label: string, fn: () => void) => void
  emitSystemNotice: (roomId: string, text: string) => void
  emitToPlayer: <E extends ServerPushEventName>(
    playerId: string,
    event: E,
    envelope: ServerPushEnvelope<E>,
  ) => void
  emitRoomEvent: <E extends ServerPushEventName>(
    roomId: string,
    event: E,
    envelope: ServerPushEnvelope<E>,
  ) => void
  emitRoomEventExcept: <E extends ServerPushEventName>(
    roomId: string,
    exceptSocketId: string,
    event: E,
    envelope: ServerPushEnvelope<E>,
  ) => void
  isPlaying: (phase: RoomPhase) => boolean
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

  /** 连通性查询：从成员事实单一口径构造，供各选择器复用。 */
  private readonly isOnline = createOnlineLookup(this.players)
  /**
   * 跨协作者能力出口（构造期赋值）：RoundMachine 与全部子服务引用它，
   * 而不是 `(...args) => this.x(...args)` 的延迟投影（见 constructor 的依赖驱动装配）。
   */
  private readonly ports: ServicePorts

  constructor(
    readonly io: AppServer,
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
    // ── 依赖驱动装配（消除「延迟闭包」）────────────────────────────────────
    // 顺序：能力出口 → 持久化/快照 → 发布 → 回合状态机 → 成员 → 会话 → 绘图/邀请/词库。
    // 每个协作者引用已构造的对象（局部字段），不再是 `(...args) => this.x(...args)` 的
    // 延迟投影——后者丢形参名，且端口的运行时依赖是整份 GameService。
    this.ports = {
      requirePlayer: (playerId) => {
        const player = this.players.get(playerId)
        if (!player) throw new GameError('UNAUTHORIZED', serverStrings.errors.UNAUTHORIZED)
        return player
      },
      requireGame: (room) => {
        if (!room.game) throw new GameError('NO_GAME', serverStrings.errors.NO_GAME)
        return room.game
      },
      // VocabularyRegistry 契约保证 get/getDefault 必存在（必选成员），无需再运行时探活。
      getRoomVocabularyStore: (room) => {
        if (room?.vocabularyPackageId) {
          const store = this.vocabulary.get(room.vocabularyPackageId)
          if (store) return store
        }
        return this.vocabulary.getDefault()
      },
      safeRun: (label, fn) => {
        try {
          fn()
        } catch (error) {
          this.logUnexpectedError(error, { scope: 'timer', label })
        }
      },
      emitSystemNotice: (roomId, text) => {
        this.io
          .to(roomId)
          .emit(EVENTS.systemNotice, createServerPush(EVENTS.systemNotice, { text }))
      },
      emitToPlayer: (playerId, event, envelope) => {
        const socket = this.players.get(playerId)?.socket
        if (!socket) return
        // 泛型事件名下 socket.io 的 Parameters<> 是延迟索引类型，函数体内无法证明实参匹配；
        // 事件↔信封配对已由本签名与 createServerPush 在调用方强制，此处只做唯一 emit 边界适配
        // （与 binder 的 on 适配同一手法）。
        ;(socket.emit as (ev: typeof event, payload: typeof envelope) => void)(event, envelope)
      },
      emitRoomEvent: (roomId, event, envelope) => {
        const broadcast = this.io.to(roomId)
        ;(broadcast.emit as (ev: typeof event, payload: typeof envelope) => void)(event, envelope)
      },
      emitRoomEventExcept: (roomId, exceptSocketId, event, envelope) => {
        const broadcast = this.io.to(roomId).except(exceptSocketId)
        ;(broadcast.emit as (ev: typeof event, payload: typeof envelope) => void)(event, envelope)
      },
      isPlaying: (phase) => isInMatchPhase(phase),
    }
    // 共享端口对象：同一出口只在装配层构造一次，各 Context 用对象展开复用（见 domain/shared-ports.ts）。
    // roomEventPorts 依赖 publisher，故在 publisher 之后构造（依赖驱动装配）。
    const runtimePorts: RuntimePorts = {
      clock: this.clock,
      random: this.random,
      scheduler: this.scheduler,
    }
    const playerLookupPorts: PlayerLookupPorts = {
      requirePlayer: this.ports.requirePlayer,
    }
    this.persistence = new RoomPersistenceCoordinator({
      clock: this.clock,
      repositories: this.repositories,
    })
    this.snapshotter = new SnapshotBuilder({
      players: this.players,
      rooms: this.rooms,
      clock: this.clock,
      isPlaying: this.ports.isPlaying,
      getRoomVocabularyStore: this.ports.getRoomVocabularyStore,
      requirePlayer: this.ports.requirePlayer,
    })
    this.publisher = new RoomPublisher({
      io: this.io,
      rooms: this.rooms,
      players: this.players,
      snapshot: (room, viewerId, options) => this.snapshotter.snapshot(room, viewerId, options),
      toPublicPlayer: (player) => this.snapshotter.toPublicPlayer(player),
      toPublicRoom: (room) => this.snapshotter.toPublicRoom(room),
      logError: (error, context) => this.logUnexpectedError(error, context),
    })
    const roomEventPorts: RoomEventPorts = {
      broadcastPresence: () => this.publisher.broadcastPresence(),
      emitRoom: (roomId) => this.publisher.emitRoom(roomId),
      emitRoomEvent: this.ports.emitRoomEvent,
    }
    this.round = new RoundMachine({
      players: this.players,
      logger: this.logger,
      clock: this.clock,
      scheduler: this.scheduler,
      random: this.random,
      getRoomVocabularyStore: this.ports.getRoomVocabularyStore,
      requireGame: this.ports.requireGame,
      emitSystemNotice: this.ports.emitSystemNotice,
      emitRoom: (roomId) => this.publisher.emitRoom(roomId),
      broadcastPresence: () => this.publisher.broadcastPresence(),
      persistGameResult: (room, reason) => this.persistence.persistGameResult(room, reason),
      safeRun: this.ports.safeRun,
    })
    this.membership = new RoomMembershipService({
      ...runtimePorts,
      ...roomEventPorts,
      ...playerLookupPorts,
      abandonChoosing: (room, notice) => this.round.abandonChoosing(room, notice),
      addSystemNotice: (room, text) => this.round.addSystemNotice(room, text),
      clearHintTimers: (game) => this.round.clearHintTimers(game),
      emitToPlayer: this.ports.emitToPlayer,
      evaluateRematch: (room) => this.round.evaluateRematch(room),
      finishRound: (room, drawerAbandoned) => this.round.finishRound(room, drawerAbandoned),
      getRoomVocabularyStore: this.ports.getRoomVocabularyStore,
      isPlaying: this.ports.isPlaying,
      logger: this.logger,
      pauseRoomInternal: (room, reason) => this.round.pauseRoomInternal(room, reason),
      players: this.players,
      rooms: this.rooms,
      roomsByPrivateCode: this.roomsByPrivateCode,
      setWaiting: (room, notice, resetReady) => this.round.setWaiting(room, notice, resetReady),
      snapshot: (room, playerId) => this.snapshotter.snapshot(room, playerId),
      transition: (room, next) => this.round.transition(room, next),
      vocabulary: this.vocabulary,
    })
    this.session = new SessionService({
      ...runtimePorts,
      ...roomEventPorts,
      ...playerLookupPorts,
      emitRoomEventExcept: this.ports.emitRoomEventExcept,
      finishRound: (room, drawerAbandoned) => this.round.finishRound(room, drawerAbandoned),
      leaveRoom: (playerId, reason) => this.membership.leaveRoom(playerId, reason),
      logger: this.logger,
      persistPlayer: (player) => this.persistence.persistPlayer(player),
      players: this.players,
      playersByTokenDigest: this.playersByTokenDigest,
      repositories: this.repositories,
      rooms: this.rooms,
      transferDisconnectedHost: (room, playerId) =>
        this.membership.transferDisconnectedHost(room, playerId),
      safeRun: this.ports.safeRun,
      toPublicPlayer: (player) => this.snapshotter.toPublicPlayer(player),
    })
    this.drawing = new DrawingService({
      ...runtimePorts,
      ...roomEventPorts,
      getSession: (playerId, roundId) => this.getDrawingSession(playerId, roundId),
      publishStroke: (payload) =>
        this.io
          .to(payload.roomId)
          .emit(EVENTS.drawStrokeBatch, createServerPush(EVENTS.drawStrokeBatch, payload)),
      publishFill: (payload) =>
        this.io
          .to(payload.roomId)
          .emit(EVENTS.drawFillCommit, createServerPush(EVENTS.drawFillCommit, payload)),
    })
    this.invitation = new InviteService({
      ...runtimePorts,
      invites: this.invites,
      getMembership: (playerId) => this.membership.requireMembership(playerId),
      getPlayer: this.ports.requirePlayer,
      getRoom: (roomId) => this.rooms.get(roomId),
      join: (playerId, room) =>
        this.membership.joinResolvedRoom(
          this.membership.requireAvailablePlayer(playerId),
          room,
          'invite',
        ),
      toPublicInvite: (invite) => this.snapshotter.toPublicInvite(invite),
      emitInvite: (target, invite) =>
        target.socket?.emit(EVENTS.inviteReceived, createServerPush(EVENTS.inviteReceived, invite)),
      emitResolved: (invite, id, status) => {
        const payload = createServerPush(EVENTS.inviteResolved, { id, status })
        this.ports.emitToPlayer(invite.fromPlayerId, EVENTS.inviteResolved, payload)
        this.ports.emitToPlayer(invite.toPlayerId, EVENTS.inviteResolved, payload)
      },
      safeRun: this.ports.safeRun,
    })
    this.roomVocabulary = new RoomVocabularyService({
      ...roomEventPorts,
      registry: this.vocabulary,
      getMembership: (playerId) => this.membership.requireMembership(playerId),
      getHostRoom: (playerId) => this.membership.requireHostRoom(playerId),
      getStore: this.ports.getRoomVocabularyStore,
      addNotice: (room, text) => this.round.addSystemNotice(room, text),
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
    socket: AppSocket,
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
  logout(socket: AppSocket): void {
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
    const { room, member } = this.membership.requireMembership(playerId)
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
    const room = this.membership.requireHostRoom(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('SETTINGS_LOCKED', serverStrings.errors.SETTINGS_LOCKED_UPDATE)
    // 乐观并发控制：版本号不匹配说明有其他玩家改过规则，拒绝本次修改
    if (room.stateVersion !== expectedVersion)
      throw new GameError('VERSION_CONFLICT', serverStrings.errors.VERSION_CONFLICT_SETTINGS)
    const next = { ...room.settings, ...patch }
    // 规则范围由 RoomSettingsSchema（含 partial 更新）在绑定层裁决；
    // 这里只保留 schema 给不了的房间态领域判定：最大人数不能小于当前占席成员数（含离局占位与观战），否则会出现超员
    const seatedMembers = room.members.filter(occupiesSeat)
    if (next.maxPlayers < seatedMembers.length)
      throw new GameError('INVALID_SETTINGS', serverStrings.errors.INVALID_SETTINGS_MAX_PLAYERS)
    room.settings = next
    // 本方法不改动成员数组（席位在创建/离房/回等待时已保持紧凑），无需重排；
    // 人数上限的缩容下限已由上方超员校验拒绝。
    this.round.invalidateReady(room, serverStrings.notices.rulesUpdated)
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
    const room = this.membership.requireHostRoom(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_GAME_STARTED)
    if (room.stateVersion !== expectedVersion)
      throw new GameError('VERSION_CONFLICT', serverStrings.errors.VERSION_CONFLICT_START)
    // 开局硬性门槛：至少 2 名可玩成员且全部在线；只有非房主成员需要显式准备。
    const activeMembers = activePlayers(room)
    if (activeMembers.length < APP_CONFIG.player.minPlayers)
      throw new GameError('NOT_ENOUGH_PLAYERS', serverStrings.errors.NOT_ENOUGH_PLAYERS)
    const allOnline = activeMembers.every((member) => isOnlinePlayer(member, this.isOnline))
    const guestsReady = activeMembers
      .filter((member) => member.playerId !== room.hostId)
      .every((member) => member.ready)
    if (!allOnline || !guestsReady)
      throw new GameError('NOT_ALL_READY', serverStrings.errors.NOT_ALL_READY)
    // 本局词条数必须不少于最小词数（MIN_SELECTED_VOCABULARY_WORDS）且覆盖选词候选数
    const requiredWords = Math.max(MIN_SELECTED_VOCABULARY_WORDS, room.settings.optionCount)
    if (room.selectedWordIds.size < requiredWords) {
      throw new GameError(
        'VOCABULARY_TOO_SMALL',
        serverStrings.errors.VOCABULARY_TOO_SMALL_GAME(requiredWords),
      )
    }

    // 校验通过后交给回合状态机：GameSecret 的诞生与倒计时全归 RoundMachine（ADR-0024 时序收口）。
    // 完整 game 已安装后才广播，避免客户端收到阶段存在但 game 缺失的中间态。
    this.round.beginStarting(room, activeMembers)
    this.emitRoom(room.id)
    return this.snapshotter.snapshot(room, playerId)
  }

  chooseWord(playerId: string, roundId: string, wordId: string): void {
    const { room } = this.membership.requireMembership(playerId)
    const game = this.requireGame(room)
    // 只有当前画家在同一回合的选词阶段可以选题
    if (room.phase !== 'choosing_word' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER_CHOOSE)
    }
    if (isPhaseExpired(game, this.clock.now())) {
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    }
    const answer = game.candidates.find((word) => word.id === wordId)
    if (!answer) throw new GameError('INVALID_WORD_ID', serverStrings.errors.INVALID_WORD_ID_CHOOSE)
    this.round.beginDrawing(room, answer)
  }

  /** 画家在选词阶段更换一组候选词（每回合最多允许一次） */
  rerollWordOptions(playerId: string, roundId: string): void {
    const { room } = this.membership.requireMembership(playerId)
    const game = this.requireGame(room)
    if (room.phase !== 'choosing_word' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER_CHOOSE)
    }
    if (isPhaseExpired(game, this.clock.now())) {
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    }
    if (!room.settings.allowWordReroll) {
      throw new GameError('REROLL_DISABLED', serverStrings.errors.REROLL_DISABLED)
    }
    if (game.rerollUsed) {
      throw new GameError('REROLL_ALREADY_USED', serverStrings.errors.REROLL_ALREADY_USED)
    }

    // 重新抽取候选词（pickCandidates 会从未展示词池抽取、按多样性分布并记录进 offeredWordIds）
    game.candidates = this.round.pickCandidates(room, game)
    game.rerollUsed = true
    this.emitRoom(room.id)
  }

  submitGuess(playerId: string, roundId: string, rawText: string): { correct: boolean } {
    const { room, member } = this.membership.requireMembership(playerId)
    const game = this.requireGame(room)
    // 仅作画阶段可猜词，且必须在当前回合，且答案已确定；观战者不能猜词
    if (room.phase !== 'drawing' || game.roundId !== roundId || !game.answer)
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_GUESS)
    if (isPhaseExpired(game, this.clock.now()))
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
    this.round.addMessage(room, { type: 'guess', text, playerId })
    this.emitRoom(room.id)
    return { correct: false }
  }

  sendPreset(playerId: string, roundId: string, preset: string): void {
    const { room, member } = this.membership.requireMembership(playerId)
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
    this.round.addMessage(room, { type: 'preset', text: preset, playerId })
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
    const { room, player } = this.membership.requireMembership(playerId)
    if (!room.settings.allowPause)
      throw new GameError('PAUSE_DISABLED', serverStrings.errors.PAUSE_DISABLED)
    // 不可暂停的阶段（如开局倒计时）直接拒绝，避免静默无效或破坏计时现场
    if (!this.round.isPausable(room.phase))
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_PAUSE)
    const safeReason = reason.trim().slice(0, 40) || serverStrings.notices.pauseFallbackReason
    // 普通玩家只能发出暂停请求（房主见通知），房主直接执行暂停
    if (room.hostId !== playerId) {
      this.round.addSystemNotice(
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
    const room = this.membership.requireHostRoom(playerId)
    // 恢复时序（重建 phaseStartedAt/phaseEndsAt、清理暂停现场、重排当前阶段计时器）
    // 归 RoundMachine 所有，与 pause 成对；此处只做房主守卫与广播。
    this.round.resume(room)
    this.emitRoom(room.id)
  }

  /** 房主提前结束比赛：仅对局进行中（不含开局倒计时，尚未正式开赛）或暂停时可触发，直接进入最终结算。 */
  endEarly(playerId: string): void {
    const room = this.membership.requireHostRoom(playerId)
    // starting（3 秒开局倒计时）不算可提前结束的比赛：此时 game 已预建但没有进行中的回合，
    // 若放行会试图执行领域不允许的 starting → game_result 转换。isPlaying 已含 paused。
    const inProgress = this.isPlaying(room.phase) && room.phase !== 'starting'
    if (!inProgress)
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_END_EARLY)
    this.round.finishGame(room, serverStrings.notices.endEarlyByHost)
  }

  /** 最终结算再来一局入口：普通成员只登记个人意愿，房主请求由状态机在最短展示期后全局执行。 */
  returnWaiting(playerId: string): void {
    const { room, member } = this.membership.requireMembership(playerId)
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

  handleDisconnect(socket: AppSocket): void {
    return this.session.handleDisconnect(socket)
  }

  /**
   * 向房间所有成员推送各自的角色裁剪快照。
   * 每个成员看到的答案/候选词不同，因此必须以成员为观看者分别生成。
   * @internal 内部协作接口（RoundMachine / 模块间调用）
   */
  public emitRoom(roomId: string): void {
    this.publisher.emitRoom(roomId)
  }

  /**
   * 在线玩家与公开房间列表同源广播；独立 room:listChanged 事件让大厅可明确订阅房间变化，
   * presence:snapshot 则继续承担初始全量同步和向后兼容。
   * @internal 内部协作接口（RoundMachine / 模块间调用）
   */
  public broadcastPresence(): void {
    this.publisher.broadcastPresence()
  }

  /** 大厅在线状态快照：只包含可发现玩家与全部未关闭房间。 */
  presenceSnapshot(): PresenceSnapshot {
    return this.publisher.presenceSnapshot()
  }

  /** 大厅公开房间列表：room:list 专用，与 presenceSnapshot 的房间部分同源同口径。 */
  publicRooms(): PresenceSnapshot['rooms'] {
    return this.publisher.publicRooms()
  }

  /** 取指定玩家的当前房间快照（用于断线恢复/重同步），不要求玩家在线。 */
  snapshotForPlayer(playerId: string, forceFull = false): RoomSnapshot | undefined {
    return this.publisher.snapshotForPlayer(playerId, forceFull)
  }

  /** 取玩家身份；身份不在册时抛 UNAUTHORIZED（端口实现见装配层 ports）。 */
  public requirePlayer(playerId: string): PlayerSecret {
    return this.ports.requirePlayer(playerId)
  }

  /** @internal 绘图协作者的窄查询入口。 */
  public getDrawingSession(
    playerId: string,
    roundId: string,
  ): { player: PlayerSecret; room: RoomSecret; game: GameSecret } {
    const membership = this.membership.requireMembership(playerId)
    return {
      ...membership,
      game: this.requireDrawerGame(membership.room, playerId, roundId),
    }
  }

  /**
   * 取对局秘密，房间没有进行中的游戏时抛 NO_GAME。
   * @internal 内部协作接口（handlers / 模块间调用；端口实现见装配层 ports）
   */
  public requireGame(room: RoomSecret): GameSecret {
    return this.ports.requireGame(room)
  }

  /** 取对局并要求调用者是当前回合画家（绘图权限守卫）。 */
  private requireDrawerGame(room: RoomSecret, playerId: string, roundId: string): GameSecret {
    const game = this.requireGame(room)
    if (room.phase !== 'drawing' || game.drawerId !== playerId || game.roundId !== roundId)
      throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER)
    if (isPhaseExpired(game, this.clock.now()))
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    return game
  }

  /**
   * 是否为对局进行中的阶段（含暂停）：用于「是否已开赛」与大厅玩家状态展示。
   * 阶段白名单唯一来源是 phase-facts；此前不含 paused，使暂停房间成员在大厅被显示为
   * 「房间中」而非「游戏中」。
   * @internal 内部协作接口（RoundMachine / 模块间调用）
   */
  public isPlaying(phase: RoomPhase): boolean {
    return this.ports.isPlaying(phase)
  }
}
