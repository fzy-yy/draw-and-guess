/**
 * 服务端权威游戏服务。
 *
 * 本类独占所有可改变比赛结果的状态：身份、成员资格、准备、阶段、答案、计时、绘图与分数。
 * Socket 处理器只负责校验载荷并调用这些方法，客户端永远不能上传裁决结果。
 */
import { RoomPersistenceCoordinator } from './application/room-persistence-coordinator.ts'
import { RoomMembershipService } from './domain/room/room-membership-service.ts'
import { SessionService } from './domain/session/session-service.ts'
import { slidingWindowAllow } from './rate-limit.ts'
import {
  type CanvasPingType,
  ERROR_CODES,
  EVENTS,
  MIN_SELECTED_VOCABULARY_WORDS,
  RELAY_MIN_PLAYERS,
  createServerPush,
  isNearMissAnswer,
  normalizeAnswer,
  type ErrorCode,
  type FillCommand,
  type GameMode,
  type Invite,
  type PresenceSnapshot,
  type Profile,
  type PublicPlayer,
  type RelayVoteChoice,
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
import { markAllSynced } from './domain/drawing/canvas-sync.ts'
import {
  DrawingService,
  createRoomBroadcastPublisher,
  type DrawingSession,
} from './domain/drawing/drawing-service.ts'
import {
  resolveRelayCanvasTarget,
  type RelayCanvasRejection,
} from './domain/relay/relay-canvas-target.ts'
import { createSilentPublisher } from './domain/relay/relay-publisher.ts'
import { RelayMachine } from './domain/relay/relay-machine.ts'
import type { RelayGameSecret } from './domain/relay/relay-models.ts'
import { InviteService } from './domain/invite/invite-service.ts'
import { RoomVocabularyService } from './domain/vocabulary/room-vocabulary-service.ts'
import { buildCustomWord } from './domain/vocabulary/custom-word.ts'
import type { PlayerLookupPorts, RoomEventPorts, RuntimePorts } from './domain/shared-ports.ts'
import {
  activePlayers,
  createOnlineLookup,
  isOnlinePlayer,
  isPhaseExpired,
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
  /** 取接龙局秘密；房间没有进行中的接龙局时抛 NO_GAME（与 requireGame 同口径，S56）。 */
  requireRelay: (room: RoomSecret) => RelayGameSecret
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
 * 生命周期公共面（S55）：经典回合机与接龙状态机**都**实现的原语，
 * 供装配层按房间玩法统一委托（`lifecycle(room)`），跨模式的共享入口不必自己判断模式。
 * 模式独有的推进（开局、选词、作画、复盘…）不回落到这里，由调用点分派到具体机器。
 */
interface RoomLifecycle {
  transition(room: RoomSecret, next: RoomPhase): void
  invalidateReady(room: RoomSecret, notice: string, versionMode?: 'increment' | 'preserve'): void
  addSystemNotice(room: RoomSecret, text: string): void
}

/**
 * 接龙绘图解析拒绝 → 协议错误码（复用既有错误码体系，不新增码；映射表放装配层，
 * 领域原因本身在 domain/relay 只表达「为什么拒绝」）。
 */
const RELAY_CANVAS_ERROR_CODES: Record<RelayCanvasRejection, ErrorCode> = {
  'stale-step': ERROR_CODES.STALE_DRAW_EVENT,
  'not-drawing-step': ERROR_CODES.NOT_DRAWER,
  'not-participant': ERROR_CODES.NOT_DRAWER,
  'already-submitted': ERROR_CODES.ALREADY_SUBMITTED,
}

/**
 * 模式 → 生效的规则键名（S52 的**唯一来源**）。
 *
 * 共用键（候选词数 / 换一批 / 自定义题目 / 房间内邀请）两种模式都生效；
 * 经典专属键只在经典房生效，接龙三时长只在接龙房生效。
 * `updateSettings` 据此**严格拒绝**补丁里出现的不生效键（S52）；
 * 客户端无法 import 服务端模块，在 `apps/client/src/utils/room-facts.ts` 按同一清单声明，
 * 两端一致由 `test/unit/room-settings-mode-whitelist.spec.ts` 守护。
 */
export const MODE_SETTINGS_KEYS = {
  classic: [
    'roundsPerPlayer',
    'drawSeconds',
    'chooseSeconds',
    'allowChooseTimeLimit',
    'showWordLength',
    'progressiveHints',
    'allowPause',
    'allowNearMissHint',
    'allowCanvasReactions',
    'allowRoundReplay',
    'optionCount',
    'allowWordReroll',
    'allowCustomWord',
    'allowPlayerInvite',
  ],
  relay: [
    'relayChooseSeconds',
    'relayDrawSeconds',
    'relayGuessSeconds',
    'optionCount',
    'allowWordReroll',
    'allowCustomWord',
    'allowPlayerInvite',
  ],
} as const satisfies Record<GameMode, readonly (keyof RoomSettings)[]>

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
  /** 接龙生命周期状态机：与经典回合机**平级**，按房间玩法经 `lifecycle` 分派（S55）。 */
  readonly relay: RelayMachine
  /** 视图裁剪（快照组装）构建器。 */
  readonly snapshotter: SnapshotBuilder
  /** 绘图命令用例协作者；GameService 保留兼容委托入口。 */
  readonly drawing: DrawingService
  /** 接龙绘图命令用例协作者：目标＝本棒链画布，发布策略＝静默（S2，工单 04）。 */
  readonly relayDrawing: DrawingService
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
      requireRelay: (room) => {
        if (!room.relay) throw new GameError('NO_GAME', serverStrings.errors.NO_GAME)
        return room.relay
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
    // 接龙状态机与经典回合机平级（S55）：只吃窄端口，不反向依赖整机服务
    this.relay = new RelayMachine({
      logger: this.logger,
      clock: this.clock,
      scheduler: this.scheduler,
      random: this.random,
      getRoomVocabularyStore: this.ports.getRoomVocabularyStore,
      requireRelay: this.ports.requireRelay,
      // 掉队代交的在场事实：断线时刻取自玩家身份（宽限 = 断线时刻 + 短宽限，S8）
      getPlayerPresence: (playerId) => {
        const player = this.players.get(playerId)
        return { connected: player?.connected === true, disconnectedAt: player?.disconnectedAt }
      },
      emitSystemNotice: this.ports.emitSystemNotice,
      emitRoom: (roomId) => this.publisher.emitRoom(roomId),
      broadcastPresence: () => this.publisher.broadcastPresence(),
      safeRun: this.ports.safeRun,
      // 终局榜冻结要昵称与头像；离局成员另用 leftProfile（S37）
      players: this.players,
      persistGameResult: (room, reason) => this.persistence.persistGameResult(room, reason),
      // 回等待复用经典的等待收敛：接龙局秘密先由接龙状态机自己回收（否则等待中的房间会留着已作废的接龙局）
      setWaiting: (room, notice) => {
        this.relay.discard(room)
        this.round.setWaiting(room, notice)
      },
    })
    this.membership = new RoomMembershipService({
      ...runtimePorts,
      ...roomEventPorts,
      ...playerLookupPorts,
      abandonChoosing: (room, notice) => this.round.abandonChoosing(room, notice),
      addSystemNotice: (room, text) => this.lifecycle(room).addSystemNotice(room, text),
      clearHintTimers: (game) => this.round.clearHintTimers(game),
      emitToPlayer: this.ports.emitToPlayer,
      // 结算期的「再来一局」评估按模式分流（接龙与经典的结算字段各自独立，S55）
      evaluateRematch: (room) =>
        room.gameMode === 'relay'
          ? this.relay.evaluateRematch(room)
          : this.round.evaluateRematch(room),
      finishRound: (room, drawerAbandoned) => this.round.finishRound(room, drawerAbandoned),
      getRoomVocabularyStore: this.ports.getRoomVocabularyStore,
      isPlaying: this.ports.isPlaying,
      logger: this.logger,
      pauseRoomInternal: (room, reason) => this.round.pauseRoomInternal(room, reason),
      players: this.players,
      rooms: this.rooms,
      roomsByPrivateCode: this.roomsByPrivateCode,
      // 成员离开 / 退局后重算接龙本步的代交（离开者仍占链位、后续每步自动代交，S7 / S8）
      refreshRelayAutoSubmit: (room, playerId) => this.relay.refreshAutoSubmit(room, playerId),
      setWaiting: (room, notice, resetReady) => {
        // 接龙局随经典对局一起清场：经典 setWaiting 只回收 room.game，
        // 接龙秘密必须由接龙状态机自己回收，否则等待中的房间会留着一份已作废的接龙局。
        this.relay.discard(room)
        this.round.setWaiting(room, notice, resetReady)
      },
      snapshot: (room, playerId) => this.snapshotter.snapshot(room, playerId),
      transition: (room, next) => this.lifecycle(room).transition(room, next),
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
      // 接龙对局阶段断线：按短宽限安排本步代交（宽限内重连即让路，S8）
      refreshRelayAutoSubmit: (room, playerId) => this.relay.refreshAutoSubmit(room, playerId),
      repositories: this.repositories,
      rooms: this.rooms,
      transferDisconnectedHost: (room, playerId) =>
        this.membership.transferDisconnectedHost(room, playerId),
      safeRun: this.ports.safeRun,
      toPublicPlayer: (player) => this.snapshotter.toPublicPlayer(player),
    })
    this.drawing = new DrawingService({
      clock: this.clock,
      getSession: (playerId, roundId) => this.classicDrawingSession(playerId, roundId),
      // 经典模式的发布策略：全房广播（接龙实例注入「静默」实现，见工单 04 / S2）。
      publisher: createRoomBroadcastPublisher(roomEventPorts),
    })
    // 接龙绘图用例：目标＝本棒链画布，发布策略＝静默——命令只留在链的权威历史里，不广播（S2）。
    this.relayDrawing = new DrawingService({
      clock: this.clock,
      getSession: (playerId, stepId) => this.relayDrawingSession(playerId, stepId),
      publisher: createSilentPublisher(),
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
    input: {
      name: string
      visibility: RoomVisibility
      /** 玩法模式（经典 / 接龙）：建房时确定、房间内不可修改（S27 / S28）；缺省为经典。 */
      gameMode?: GameMode
      settings: RoomSettings
    },
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

  /** 切换准备状态（仅等待阶段），并递增版本号通知全员。 */
  setReady(playerId: string, ready: boolean): RoomSnapshot {
    const { room, member } = this.membership.requireMembership(playerId)
    if (room.phase !== 'waiting')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_READY)
    // 房主由服务端视为隐式准备；同值重复请求幂等返回，不污染状态版本。
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
    // 模式白名单（S52）：补丁里只允许出现当前模式生效的键。不生效键一律按非法设置拒绝而不是静默忽略，
    // 否则房主会以为改动生效；客户端的完整草稿由 stores/room.ts 按同一清单裁剪后再上送。
    const effectiveKeys: readonly string[] = MODE_SETTINGS_KEYS[room.gameMode]
    if (Object.keys(patch).some((key) => !effectiveKeys.includes(key)))
      throw new GameError('INVALID_SETTINGS', serverStrings.errors.INVALID_SETTINGS)
    const next = { ...room.settings, ...patch }
    // 规则范围由 RoomSettingsSchema（含 partial 更新）在绑定层裁决，模式生效键由上方白名单裁决；
    // 容量固定为协议常量，因此不存在「人数上限低于占席数」这类房间态领域判定。
    room.settings = next
    this.lifecycle(room).invalidateReady(room, serverStrings.notices.rulesUpdated)
    this.emitRoom(room.id)
    // roundsPerPlayer / drawSeconds 会显示在大厅房间行中，规则变更后需同步广播大厅快照。
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
    // 开局硬性门槛：人数下限按模式分流——接龙要求**在线且可玩** ≥ RELAY_MIN_PLAYERS（S62），
    // 经典沿用 2 名可玩成员；两种模式都要求全员在线，且只有非房主成员需要显式准备。
    const activeMembers = activePlayers(room)
    if (room.gameMode === 'relay') {
      const onlineMembers = activeMembers.filter((member) => isOnlinePlayer(member, this.isOnline))
      if (onlineMembers.length < RELAY_MIN_PLAYERS)
        throw new GameError(
          'NOT_ENOUGH_PLAYERS',
          serverStrings.errors.NOT_ENOUGH_PLAYERS_RELAY(RELAY_MIN_PLAYERS),
        )
    } else if (activeMembers.length < APP_CONFIG.player.minPlayers) {
      throw new GameError('NOT_ENOUGH_PLAYERS', serverStrings.errors.NOT_ENOUGH_PLAYERS)
    }
    const allOnline = activeMembers.every((member) => isOnlinePlayer(member, this.isOnline))
    const guestsReady = activeMembers
      .filter((member) => member.playerId !== room.hostId)
      .every((member) => member.ready)
    if (!allOnline || !guestsReady)
      throw new GameError('NOT_ALL_READY', serverStrings.errors.NOT_ALL_READY)
    // 本局词条数必须不少于最小词数（MIN_SELECTED_VOCABULARY_WORDS）且覆盖选词候选数。
    // 接龙每条链都从同一词池独立抽候选（S31），因此两种模式共用同一条词库门槛。
    const requiredWords = Math.max(MIN_SELECTED_VOCABULARY_WORDS, room.settings.optionCount)
    if (room.selectedWordIds.size < requiredWords) {
      throw new GameError(
        'VOCABULARY_TOO_SMALL',
        serverStrings.errors.VOCABULARY_TOO_SMALL_GAME(requiredWords),
      )
    }

    // 校验通过后交给**对应模式**的状态机：对局秘密的诞生与倒计时全归状态机所有
    //（ADR-0024 时序收口；接龙的链数组与步 id 见 RelayMachine.beginStarting）。
    // 完整现场安装后才广播，避免客户端收到阶段存在但对局缺失的中间态。
    if (room.gameMode === 'relay') this.relay.beginStarting(room, activeMembers)
    else this.round.beginStarting(room, activeMembers)
    this.emitRoom(room.id)
    return this.snapshotter.snapshot(room, playerId)
  }

  chooseWord(playerId: string, roundId: string, wordId: string): void {
    const { room } = this.membership.requireMembership(playerId)
    // 选词三步动作复用同一条经典事件，服务端按模式分支（S50）：
    // 接龙的 `roundId` 字段承载每步的全局步 id，选的是**自己那条链**的候选（S31 / S53）。
    if (room.gameMode === 'relay') {
      this.relay.chooseWord(room, playerId, roundId, wordId)
      return
    }
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

  /** 画家在选词阶段更换一组候选词（每回合最多允许一次；接龙按链各一次，S50） */
  rerollWordOptions(playerId: string, roundId: string): void {
    const { room } = this.membership.requireMembership(playerId)
    if (room.gameMode === 'relay') {
      this.relay.rerollWordOptions(room, playerId, roundId)
      return
    }
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

  /**
   * 画家自定义题目：校验规则开关、阶段与角色后，把输入合成为一条无元数据词条并直接开画。
   * 与「换一组」并列的第三条选词出口；合成词条让 beginDrawing 的
   * 「答案必须取自候选池」不变式继续成立（见 ADR-0045）。
   */
  chooseCustomWord(playerId: string, roundId: string, rawText: string): void {
    const { room } = this.membership.requireMembership(playerId)
    if (room.gameMode === 'relay') {
      // 自定义词条同样复用经典合成器（合法性、长度与字符集口径一致）；
      // 词条 id 用步 id 派生，避免跨棒撞 id（S50 / S53）。
      this.relay.chooseCustomWord(
        room,
        playerId,
        roundId,
        buildCustomWord({ rawText, wordId: `custom:${roundId}` }),
      )
      return
    }
    const game = this.requireGame(room)
    if (room.phase !== 'choosing_word' || game.drawerId !== playerId || game.roundId !== roundId) {
      throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER_CHOOSE)
    }
    if (isPhaseExpired(game, this.clock.now())) {
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    }
    if (!room.settings.allowCustomWord) {
      throw new GameError('FORBIDDEN', serverStrings.errors.CUSTOM_WORD_DISABLED)
    }
    const word = buildCustomWord({ rawText, wordId: `custom:${game.roundId}` })
    if (this.isCustomWordDuplicate(room, game, word.text)) {
      throw new GameError('CUSTOM_WORD_DUPLICATE', serverStrings.errors.CUSTOM_WORD_DUPLICATE)
    }
    // 合成词条成为本回合唯一候选：候选池在本回合的另一处用途（换一组）此时已不可达
    game.candidates = [word]
    this.round.beginDrawing(room, word)
  }

  /**
   * 自定义词撞词判定：与本局已展示过的词或当前候选词（规范化后）相同即视为重复，
   * 避免同一局出现两次同一个词、破坏「整局不重复」的既有不变量。
   */
  private isCustomWordDuplicate(room: RoomSecret, game: GameSecret, text: string): boolean {
    const normalized = normalizeAnswer(text)
    const store = this.ports.getRoomVocabularyStore(room)
    for (const id of game.offeredWordIds) {
      const word = store.byId.get(id)
      if (word && normalizeAnswer(word.text) === normalized) return true
    }
    return game.candidates.some((word) => normalizeAnswer(word.text) === normalized)
  }

  submitGuess(playerId: string, roundId: string, rawText: string): { correct: boolean } {
    const { room, member } = this.membership.requireMembership(playerId)
    const game = this.requireGame(room)
    // 仅作画阶段可猜词，且必须在当前回合，且答案已确定
    if (room.phase !== 'drawing' || game.roundId !== roundId || !game.answer)
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_GUESS)
    if (isPhaseExpired(game, this.clock.now()))
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)

    const text = rawText.trim()
    enforceEventRate(this.requirePlayer(playerId), 'guess', this.clock) // 猜词与发言限频
    if (!text || Array.from(text).length > APP_CONFIG.player.chatMaxLength)
      throw new GameError('INVALID_MESSAGE', serverStrings.errors.INVALID_MESSAGE_EMPTY)

    const normalized = normalizeAnswer(text)
    const answer = normalizeAnswer(game.answer.text)
    // 命中正确答案：词面与全部别称均可判对（规范化后比较）
    const acceptedAnswers = [answer, ...game.answer.aliases.map((alias) => normalizeAnswer(alias))]
    const isAnswer = acceptedAnswers.includes(normalized)

    // 画家发送消息分支：如果内容为答案则拦截拒绝，非答案作为普通聊天消息广播全员
    if (game.drawerId === playerId) {
      if (isAnswer) {
        throw new GameError('DRAWER_CANNOT_GUESS', serverStrings.errors.DRAWER_CANNOT_GUESS)
      }
      this.round.addMessage(room, { type: 'guess', text, playerId })
      this.emitRoom(room.id)
      return { correct: false }
    }

    if (member.guessedAt)
      throw new GameError('ALREADY_GUESSED', serverStrings.errors.ALREADY_GUESSED)
    if (isAnswer) {
      // markCorrect 内部已负责广播（全员猜中时 finishRound，否则刷新快照），无需再重复广播
      this.round.markCorrect(room, member)
      return { correct: true }
    }
    // 未命中正确答案：作为普通猜词进入聊天流并广播全员
    this.round.addMessage(room, { type: 'guess', text, playerId })
    // 差一字私密提示：若房间开启 allowNearMissHint，且猜词与答案（主词面或任一别称）仅差一字（答案字数 >= 2 且编辑距离严格等于 1）
    // 则仅将一条私密提示消息写入当前玩家的独占快照视口（通过 recipientId 隔离），其他玩家与公屏绝对不泄漏
    const targets = [game.answer.text, ...game.answer.aliases]
    if (
      room.settings.allowNearMissHint &&
      targets.some((candidate) => isNearMissAnswer(text, candidate))
    ) {
      this.round.addMessage(room, {
        type: 'near_miss',
        text: serverStrings.notices.nearMissHint,
        recipientId: playerId,
      })
    }

    this.emitRoom(room.id)
    return { correct: false }
  }

  sendPreset(playerId: string, roundId: string, preset: string): void {
    const { room } = this.membership.requireMembership(playerId)
    const game = this.requireGame(room)
    // 预设短语只能在作画阶段发送，且必须是配置白名单内的内容
    if (room.phase !== 'drawing' || game.roundId !== roundId)
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_PRESET)
    const allowedPresets: readonly string[] = [
      ...APP_CONFIG.presets.safeChat,
      ...APP_CONFIG.presets.chatReactions,
    ]
    if (!allowedPresets.includes(preset))
      throw new GameError('INVALID_MESSAGE', serverStrings.errors.INVALID_MESSAGE_PRESET)
    this.round.addMessage(room, { type: 'preset', text: preset, playerId })
    this.emitRoom(room.id)
  }

  /**
   * 处理玩家发送的画板微表情（👍 / ❓ / 🔥）。
   * 接龙房整体禁用微表情（S19）：模式级绝对拒绝，不依赖任何房间规则开关，
   * 否则被改客户端或旧客户端可绕过展示层、向全房广播。
   * 经典房流程：
   * 1. 校验房间配置是否开启微表情交互（allowCanvasReactions === true）；
   * 2. 执行单人 1.5 秒滑动窗口限频（防刷屏）；
   * 3. 广播全员可见的轻量级推送（不入持久化、不入笔画历史）。
   */
  sendCanvasPing(playerId: string, x: number, y: number, type: CanvasPingType): void {
    const { room, player } = this.membership.requireMembership(playerId)
    // 模式守卫先于规则开关：接龙内微表情在任何阶段（含复盘 / 投票）都不可用。
    // 复用既有 FORBIDDEN 码（沿用 allowCanvasReactions 关闭时的同码口径），只给接龙专属文案。
    if (room.gameMode === 'relay') {
      throw new GameError('FORBIDDEN', serverStrings.errors.FORBIDDEN_RELAY_CANVAS_PING)
    }
    if (!room.settings.allowCanvasReactions) {
      throw new GameError('FORBIDDEN', serverStrings.errors.FORBIDDEN)
    }

    // 限制单人 1.5 秒滑动窗口（最多 1 次）
    const now = this.clock.now()
    const decision = slidingWindowAllow(player.canvasReactionTimes ?? [], now, 1_500, 1)
    player.canvasReactionTimes = decision.times
    if (!decision.allowed) {
      throw new GameError('RATE_LIMITED', serverStrings.errors.RATE_LIMITED)
    }

    // 轻量广播给房间内所有在线连接
    const broadcastPayload = {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      type,
      senderNickname: player.profile.nickname,
    }
    this.io
      .to(room.id)
      .emit(EVENTS.gameCanvasPing, createServerPush(EVENTS.gameCanvasPing, broadcastPayload))
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

  /**
   * 接龙绘图：命令写进「本棒链」的画布，**不向房间广播**（S2 / S51 / S53）。
   * 目标解析（观看者 + 步骤 id → 链画布）与越权 / 过期拒绝见 `relayDrawingSession`。
   */
  addRelayStroke(playerId: string, stepId: string, stroke: Stroke): StrokeAck {
    return this.relayDrawing.addStroke(playerId, stepId, stroke)
  }

  /** 接龙区域填充：与经典同一条内核与预算口径，ack 只带修订号。 */
  addRelayFill(playerId: string, stepId: string, fill: FillCommand): { drawingRevision: number } {
    return this.relayDrawing.addFill(playerId, stepId, fill)
  }

  /** 接龙撤销最近一条命令：只改本棒链的历史，不刷新房间快照。 */
  relayUndo(playerId: string, stepId: string): void {
    this.relayDrawing.undo(playerId, stepId)
  }

  /** 接龙重做最近一条被撤销的命令。 */
  relayRedo(playerId: string, stepId: string): void {
    this.relayDrawing.redo(playerId, stepId)
  }

  /** 接龙清空本棒链的画布（历史、预算与撤销栈一起重置）。 */
  relayClear(playerId: string, stepId: string): void {
    this.relayDrawing.clear(playerId, stepId)
  }

  /**
   * 提交本棒作画（`relay:submitDrawing`，S30）：只标记完成并锁定，交的是已有笔画。
   * 全员提交即秒切下一棒；重复提交由状态机以 ALREADY_SUBMITTED 拒绝。
   */
  submitRelayDrawing(playerId: string, stepId: string): void {
    const { room } = this.membership.requireMembership(playerId)
    this.relay.submitDrawing(room, playerId, stepId)
  }

  /**
   * 提交本棒猜词（`relay:submitGuess`，S30 / S15）：只记录文本、提交即锁定，**不进聊天流**（S20）。
   * 空提交 / 超长由状态机以 INVALID_MESSAGE 拒绝，重复提交以 ALREADY_SUBMITTED 拒绝。
   */
  submitRelayGuess(playerId: string, stepId: string, text: string): void {
    const { room } = this.membership.requireMembership(playerId)
    this.relay.submitGuess(room, playerId, stepId, text)
  }

  /**
   * 接龙自由聊天（`chat:say`，S79）：**仅接龙房间**接受（经典保持「猜词未命中即聊天」的现状，S85）。
   * 聊天是与作答彻底分离的社交频道（S20），限频沿用猜词桶。
   */
  sendRelayChat(playerId: string, text: string): void {
    const { room, player } = this.membership.requireMembership(playerId)
    this.requireRelay(room)
    enforceEventRate(player, 'guess', this.clock)
    this.relay.chat(room, playerId, text.trim())
  }

  /**
   * 投票（`relay:vote`，S13 / S14）：只有赞同 / 不赞同，点下即锁定、无弃权、一律等满倒计时。
   * 目标是服务端权威游标指向的那条链（请求里不带链信息），收票与结算全归接龙状态机。
   */
  voteRelay(playerId: string, choice: RelayVoteChoice): void {
    const { room } = this.membership.requireMembership(playerId)
    this.relay.vote(room, playerId, choice)
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
    // 复盘期（展示 + 投票）完全不可干预（S12）：没有「跳过」也没有「提前结束」——
    // 推翻他人链的展示顺序会让全员的步调错位。接龙对局期（选词/作画/猜词）可提前结束（S34）。
    if (room.phase === 'relay_showcase' || room.phase === 'relay_vote')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_END_EARLY)
    // starting（3 秒开局倒计时）不算可提前结束的比赛：此时 game 已预建但没有进行中的回合，
    // 若放行会试图执行领域不允许的 starting → game_result 转换。isPlaying 已含 paused。
    const inProgress = this.isPlaying(room.phase) && room.phase !== 'starting'
    if (!inProgress)
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_END_EARLY)
    // 结算路径按模式分流：接龙的入账与战报（mode = relay）归接龙状态机，S38 的
    // 「直接进终局、按当前分数结算」由两边的 finishGame 同口径实现。
    if (room.gameMode === 'relay') this.relay.finishGame(room, serverStrings.notices.endEarlyByHost)
    else this.round.finishGame(room, serverStrings.notices.endEarlyByHost)
  }

  /** 最终结算再来一局入口：普通成员只登记个人意愿，房主请求由状态机在最短展示期后全局执行。 */
  returnWaiting(playerId: string): void {
    const { room, member } = this.membership.requireMembership(playerId)
    if (room.gameMode === 'relay') this.relay.requestRematch(room, member)
    else this.round.requestRematch(room, member)
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
   * 经典绘图会话：画布＝本局画布（身份 / 回合 / 阶段门禁全在 `getDrawingSession` 内裁决）；
   * 命令落地后推进全员差分游标，撤销 / 重做 / 清空后刷新房间快照。
   */
  private classicDrawingSession(playerId: string, roundId: string): DrawingSession {
    const { player, room, game } = this.getDrawingSession(playerId, roundId)
    return {
      player,
      canvas: game,
      roomId: room.id,
      gameId: game.id,
      roundId,
      // 差分游标读的是画布的最新序号（闭包在命令落地后才执行），与旧的 markAllSynced 调用点同口径。
      markSynced: () => markAllSynced(room, game.lastSequence),
      refreshRoom: () => this.emitRoom(room.id),
    }
  }

  /**
   * 接龙绘图会话：把「观看者 + 步骤 id」解析到本棒链的画布（S53），解析拒绝映射成既有错误码。
   * 与经典会话不同，两个房间级副作用都是 no-op：接龙命令只留在链的权威历史里，
   * 本棒期间对房间零推送，画布随下一棒快照整幅下发（S2，工单 05/06）。
   */
  private relayDrawingSession(playerId: string, stepId: string): DrawingSession {
    const { player, room } = this.membership.requireMembership(playerId)
    // 与经典 requireGame 同口径：房间没有进行中的接龙局即 NO_GAME（经典房收到接龙事件也走这里）。
    const relay = room.relay
    if (!relay) throw new GameError('NO_GAME', serverStrings.errors.NO_GAME)
    const decision = resolveRelayCanvasTarget({ phase: room.phase, relay }, playerId, stepId)
    // 越权与非法阶段沿用经典的 NOT_DRAWER（经典 requireDrawerGame 同样把阶段 / 身份 / 回合归到这一档），
    // 步骤 id 落后用旧包码，客户端据此重新同步画布与步骤。
    if (!decision.accepted) throw new GameError(RELAY_CANVAS_ERROR_CODES[decision.reason])
    if (isPhaseExpired(relay, this.clock.now()))
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    return {
      player,
      canvas: decision.value.canvas,
      roomId: room.id,
      gameId: relay.id,
      roundId: stepId,
      markSynced: () => undefined,
      refreshRoom: () => undefined,
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
   * 生命周期状态机选择器（S55）：按房间玩法返回当前生效的状态机。
   * 两个状态机平级并存、各自拥有自己的阶段写入与准备失效，因此返回类型取二者的公共面；
   * handlers 只校验、只调用，不自行判断模式。
   */
  public lifecycle(room: RoomSecret): RoomLifecycle {
    return room.gameMode === 'relay' ? this.relay : this.round
  }

  /** 取接龙局秘密；房间没有进行中的接龙局时抛 NO_GAME（端口实现见装配层 ports）。 */
  public requireRelay(room: RoomSecret): RelayGameSecret {
    return this.ports.requireRelay(room)
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
