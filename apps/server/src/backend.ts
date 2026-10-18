/**
 * 服务端唯一装配根（Composition Root）。
 *
 * 为什么单独成文件（docs/adr/0064-single-backend-assembly.md）：
 * 1. 在此之前「生产怎么装配」写了两遍——`server.ts` 一套、`GameService` 构造函数一套——
 *    于是同一件事有两个实现、测试与生产跨的不是同一条接缝，拒绝码也随之分叉。
 * 2. 这里只做装配：内存上下文、适配器、两个状态机、六个模块服务与网关依赖。
 *    HTTP / Socket.IO / 数据库生命周期与关闭顺序留在 `server.ts`，入口只负责把两者接起来。
 * 3. 测试经同一个函数构造世界（`createBackend` + 假 io），因此单测跨的接缝就是生产跨的接缝。
 *
 * 依赖方向：本文件只依赖模块服务、领域机器与基础设施契约，不依赖 Socket 事件处理器。
 */
import {
  EVENTS,
  type RoomPhase,
  type ServerPushEnvelope,
  type ServerPushEventName,
  createServerPush,
} from '@draw-guess/shared'
import { ArchiveService } from './modules/archive/archive.service.ts'
import { ChatService } from './modules/chat/chat.service.ts'
import { RoomPublisher } from './application/room-publisher.ts'
import { RoomPersistenceCoordinator } from './application/room-persistence-coordinator.ts'
import { DomainContext } from './domain/domain-context.ts'
import { markAllSynced } from './domain/drawing/canvas-sync.ts'
import {
  createOnlineLookup,
  isPhaseExpired,
  type OnlineLookup,
} from './domain/room/member-facts.ts'
import { isInMatchPhase } from './domain/room/phase-facts.ts'
import {
  DrawingService,
  createRoomBroadcastPublisher,
  createSilentPublisher,
} from './modules/drawing/drawing.service.ts'
import type { DrawingTargetDecision } from './modules/drawing/drawing.service.ts'
import { GameplayService } from './modules/gameplay/gameplay.service.ts'
import { RoundMachine } from './modules/gameplay/round-machine.ts'
import { InviteService } from './modules/room/invite.service.ts'
import { RoomService } from './modules/room/room.service.ts'
import { RelayService } from './modules/relay/relay.service.ts'
import { RelayMachine } from './domain/relay/relay-machine.ts'
import { resolveRelayCanvasTarget } from './domain/relay/relay-canvas-target.ts'
import { SessionService } from './modules/session/session.service.ts'
import { RoomVocabularyService } from './modules/vocabulary/vocabulary.service.ts'
import type { RelayGameSecret } from './domain/relay/relay-models.ts'
import { SnapshotBuilder } from './snapshot.ts'
import { GameError, SILENT_LOGGER, runtimeErrorType, type RuntimeLogger } from './core/errors.ts'
import { serverStrings } from '@draw-guess/strings'
import { SYSTEM_RUNTIME, type RuntimeDependencies } from './runtime.ts'
import type { AppServer } from './socket-types.ts'
import type { ArchiveRepository, PlayerRepository } from './repositories/index.ts'
import type { VocabularyRegistry, VocabularyStore } from './vocabulary/index.ts'
import type { GameSecret, InviteSecret, PlayerSecret, RoomSecret } from './models.ts'
import type { WsGatewayDependencies } from './ws/gateway.ts'

/** 装配根依赖：只有世界以外的东西（连接层、持久化、词库、运行时、日志）。 */
export interface BackendDeps {
  io: AppServer
  vocabulary: VocabularyRegistry
  repositories: {
    players: PlayerRepository
    archive: ArchiveRepository
  }
  logger?: RuntimeLogger
  runtime?: RuntimeDependencies
}

/**
 * 装配结果。字段顺序即构造顺序，便于读者对照上面的依赖链。
 * 身份相关的两张表以可变 Map 暴露：测试需要模拟「身份已被清理」「令牌已被轮换掉」这类
 * 陈旧状态（生产代码只读它们）；房间与邀请表是只读视图。
 */
export interface Backend {
  readonly players: Map<string, PlayerSecret>
  /** 恢复令牌摘要索引：测试需要模拟「令牌已被轮换掉」的陈旧状态，故暴露可变表。 */
  readonly playersByTokenDigest: Map<string, PlayerSecret>
  readonly rooms: ReadonlyMap<string, RoomSecret>
  readonly roomsByPrivateCode: ReadonlyMap<string, string>
  readonly invites: ReadonlyMap<string, InviteSecret>
  /** 持久化适配器：与内存表同属这个世界的状态，运维/测试经它核对落盘。 */
  readonly repositories: {
    readonly players: PlayerRepository
    readonly archive: ArchiveRepository
  }
  /** 归档与身份落盘的统一映射（历史战绩字段口径的唯一实现）。 */
  readonly persistence: RoomPersistenceCoordinator
  readonly snapshotter: SnapshotBuilder
  readonly publisher: RoomPublisher
  readonly roundMachine: RoundMachine
  readonly relayMachine: RelayMachine
  readonly session: SessionService
  readonly room: RoomService
  readonly gameplay: GameplayService
  readonly relay: RelayService
  readonly chat: ChatService
  /** 两个绘图适配器：经典＝全房广播、接龙＝静默写入（同一接口，两种发布策略）。 */
  readonly drawing: { readonly classic: DrawingService; readonly relay: DrawingService }
  readonly invitation: InviteService
  readonly roomVocabulary: RoomVocabularyService
  /** 网关装配依赖：入口层按这一份挂载事件，不再自己拼服务。 */
  readonly gateways: WsGatewayDependencies
  emitRoom(roomId: string): void
  broadcastPresence(): void
  /** 取玩家身份（不存在即抛 UNAUTHORIZED）；与内部读取断言同源，供测试与运维核对。 */
  requirePlayer(playerId: string): PlayerSecret
  /** 启动期持久化收敛：清掉过期断线记录并把全部身份标为断开。只调用一次。 */
  recoverOnStartup(): void
}

/**
 * 生命周期公共面（S55）：经典回合机与接龙状态机都实现的原语。
 * 两者平级并存、各自拥有阶段写入，因此这里只声明共有的三种能力。
 */
interface LifecycleSurface {
  transition(room: RoomSecret, next: RoomPhase): void
  invalidateReady(room: RoomSecret, notice: string, versionMode?: 'increment' | 'preserve'): void
  evaluateRematch(room: RoomSecret): void
  addSystemNotice(room: RoomSecret, text: string): void
}

/**
 * 装配整个服务端世界。
 *
 * 副作用仅限：创建内存表、注册计时器回调与读取持久化（`recoverOnStartup`）。
 * 不开端口、不挂事件——那属于 `server.ts` 的入口职责。
 */
export function createBackend(deps: BackendDeps): Backend {
  const { io, repositories } = deps
  const logger = deps.logger ?? SILENT_LOGGER
  const runtime = deps.runtime ?? SYSTEM_RUNTIME
  const registry = deps.vocabulary

  // ── 1. 内存聚合上下文（唯一一份）──────────────────────────────────
  const domain = new DomainContext()
  const { players, playersByTokenDigest, rooms, roomsByPrivateCode, invites } = domain
  const isOnline: OnlineLookup = createOnlineLookup(players)

  // ── 2. 发射适配器：把领域事件落到 Socket.IO ────────────────────────
  const emitRoomEvent = <E extends ServerPushEventName>(
    roomId: string,
    event: E,
    envelope: ServerPushEnvelope<E>,
  ): void => {
    ;(io.to(roomId).emit as (ev: typeof event, payload: typeof envelope) => void)(event, envelope)
  }

  const emitRoomEventExcept = <E extends ServerPushEventName>(
    roomId: string,
    exceptSocketId: string,
    event: E,
    envelope: ServerPushEnvelope<E>,
  ): void => {
    ;(
      io.to(roomId).except(exceptSocketId).emit as (
        ev: typeof event,
        payload: typeof envelope,
      ) => void
    )(event, envelope)
  }

  const emitToPlayer = <E extends ServerPushEventName>(
    playerId: string,
    event: E,
    envelope: ServerPushEnvelope<E>,
  ): void => {
    const socket = players.get(playerId)?.socket
    if (!socket) return
    ;(socket.emit as (ev: typeof event, payload: typeof envelope) => void)(event, envelope)
  }

  // ── 3. 读取断言与事实选择器 ────────────────────────────────────────
  // 断言一律抛 GameError：错误码是客户端恢复动作的唯一依据，裸 Error 会退化成 INTERNAL_ERROR。
  const requirePlayer = (playerId: string): PlayerSecret => {
    const player = players.get(playerId)
    if (!player) throw new GameError('UNAUTHORIZED', serverStrings.errors.UNAUTHORIZED)
    return player
  }

  const requireGame = (room: RoomSecret): GameSecret => {
    if (!room.game) throw new GameError('NO_GAME', serverStrings.errors.NO_GAME)
    return room.game
  }

  const requireRelay = (room: RoomSecret): RelayGameSecret => {
    if (!room.relay) throw new GameError('NO_GAME', serverStrings.errors.NO_GAME)
    return room.relay
  }

  const isPlaying = (phase: RoomPhase): boolean => isInMatchPhase(phase)

  const getRoomVocabularyStore = (room?: RoomSecret): VocabularyStore => {
    if (room?.vocabularyPackageIds?.length) {
      return registry.getCombined(room.vocabularyPackageIds)
    }
    if (room?.vocabularyPackageId) {
      const store = registry.get(room.vocabularyPackageId)
      if (store) return store
    }
    return registry.getDefault()
  }

  const safeRun = (label: string, fn: () => void): void => {
    try {
      fn()
    } catch (err) {
      logger.error({ errorType: runtimeErrorType(err), label }, '未预期的服务器内部错误')
    }
  }

  // ── 4. 视图裁剪、发布与归档 ────────────────────────────────────────
  const archiveService = new ArchiveService(repositories.archive, logger)

  /**
   * 归档与身份落盘的统一映射：两种模式的字段口径、空榜守卫都只在这里维护。
   * 写库仍经 ArchiveService，保留「落盘失败不阻断结算广播」的既有语义与白名单日志。
   */
  const persistence = new RoomPersistenceCoordinator({
    clock: runtime.clock,
    repositories: {
      players: repositories.players,
      archive: {
        saveGame: (record, results) => {
          archiveService.archiveGame(record, results)
        },
      },
    },
  })

  const snapshotter = new SnapshotBuilder({
    players,
    rooms,
    clock: runtime.clock,
    isPlaying,
    getRoomVocabularyStore,
    vocabularyPackages: () => registry.packages,
    requirePlayer,
  })

  const publisher = new RoomPublisher({
    io,
    rooms,
    players,
    snapshot: (room, viewerId, options) => snapshotter.snapshot(room, viewerId, options),
    toPublicPlayer: (player) => snapshotter.toPublicPlayer(player),
    toPublicRoom: (room) => snapshotter.toPublicRoom(room),
    logError: (err, context) =>
      logger.error({ ...context, errorType: runtimeErrorType(err) }, '未预期的服务器内部错误'),
  })

  const emitRoom = (roomId: string): void => publisher.emitRoom(roomId)
  const broadcastPresence = (): void => publisher.broadcastPresence()

  /** 完成局落盘：映射与空榜守卫归 RoomPersistenceCoordinator，两种模式同一个入口。 */
  const persistGameResult = (room: RoomSecret, reason: string): void => {
    persistence.persistGameResult(room, reason)
  }

  // ── 5. 两个平级状态机（模式独有的推进归各自，生命周期公共面见 ADR-0058）──
  const roundMachine = new RoundMachine({
    players,
    logger,
    clock: runtime.clock,
    scheduler: runtime.scheduler,
    random: runtime.random,
    getRoomVocabularyStore,
    requireGame,
    emitSystemNotice: (roomId, text) =>
      io.to(roomId).emit(EVENTS.systemNotice, createServerPush(EVENTS.systemNotice, { text })),
    emitRoom,
    broadcastPresence,
    persistGameResult,
    safeRun,
  })

  const relayMachine = new RelayMachine({
    players,
    logger,
    clock: runtime.clock,
    scheduler: runtime.scheduler,
    random: runtime.random,
    getRoomVocabularyStore,
    requireRelay,
    emitSystemNotice: (roomId, text) =>
      io.to(roomId).emit(EVENTS.systemNotice, createServerPush(EVENTS.systemNotice, { text })),
    emitRoom,
    broadcastPresence,
    persistGameResult,
    setWaiting: (room, notice) => {
      roundMachine.setWaiting(room, notice)
    },
    safeRun,
  })

  /**
   * 生命周期公共面（S55）：两个状态机都实现的原语，按房间模式委托。
   * 用窄接口而不是联合类型，是为了让调用点只看到这三种能力——
   * 模式独有的推进不在这里，由调用方分派到具体机器（ADR-0058）。
   */
  const lifecycle = (room: RoomSecret): LifecycleSurface =>
    room.gameMode === 'relay' ? relayMachine : roundMachine

  // ── 6. 模块服务 ────────────────────────────────────────────────────
  const roomService = new RoomService({
    clock: runtime.clock,
    random: runtime.random,
    scheduler: runtime.scheduler,
    logger,
    players,
    rooms,
    roomsByPrivateCode,
    vocabulary: registry,
    requirePlayer,
    broadcastPresence,
    emitRoom,
    emitRoomEvent,
    emitToPlayer,
    snapshot: (room, playerId) => snapshotter.snapshot(room, playerId),
    transition: (room, next) => lifecycle(room).transition(room, next),
    invalidateReady: (room, notice) => lifecycle(room).invalidateReady(room, notice),
    setWaiting: (room, notice, resetReady) => {
      relayMachine.discard(room)
      roundMachine.setWaiting(room, notice, resetReady)
    },
    evaluateRematch: (room) => lifecycle(room).evaluateRematch(room),
    finishRound: (room, drawerAbandoned) => roundMachine.finishRound(room, drawerAbandoned),
    abandonChoosing: (room, notice) => roundMachine.abandonChoosing(room, notice),
    addSystemNotice: (room, text) => lifecycle(room).addSystemNotice(room, text),
    clearHintTimers: (game) => roundMachine.clearHintTimers(game),
    getRoomVocabularyStore,
    isPlaying,
  })

  const sessionService = new SessionService({
    clock: runtime.clock,
    random: runtime.random,
    scheduler: runtime.scheduler,
    logger,
    players,
    playersByTokenDigest,
    rooms,
    repositories: {
      players: repositories.players,
    },
    requirePlayer,
    broadcastPresence,
    emitRoom,
    emitRoomEvent,
    emitRoomEventExcept,
    toPublicPlayer: (player) => snapshotter.toPublicPlayer(player),
    finishRound: (room, drawerAbandoned) => roundMachine.finishRound(room, drawerAbandoned),
    leaveRoom: (playerId, reason) => roomService.leaveRoom(playerId, reason),
    persistPlayer: (player) => persistence.persistPlayer(player),
    transferDisconnectedHost: (room, playerId) =>
      roomService.transferDisconnectedHost(room, playerId),
    safeRun,
  })

  const inviteService = new InviteService({
    clock: runtime.clock,
    random: runtime.random,
    scheduler: runtime.scheduler,
    invites,
    getMembership: (playerId) => roomService.requireMembership(playerId),
    getPlayer: requirePlayer,
    getRoom: (roomId) => rooms.get(roomId),
    join: (playerId, room) => roomService.joinResolvedRoom(requirePlayer(playerId), room, 'invite'),
    // 公开邀请视图归快照构建器（与角色裁剪同一处）：房间已关闭时抛 ROOM_NOT_FOUND，
    // 而不是悄悄给出空房间名——邀请一旦不可达就不该继续出现在界面上。
    toPublicInvite: (invite) => snapshotter.toPublicInvite(invite),
    emitInvite: (target, publicInvite) => {
      target.socket?.emit(
        EVENTS.inviteReceived,
        createServerPush(EVENTS.inviteReceived, publicInvite),
      )
    },
    // 邀请解析只与当事人有关：定向发给收发双方，不做全局广播（隐私口径）。
    emitResolved: (invite, id, status) => {
      const payload = createServerPush(EVENTS.inviteResolved, { id, status })
      emitToPlayer(invite.fromPlayerId, EVENTS.inviteResolved, payload)
      emitToPlayer(invite.toPlayerId, EVENTS.inviteResolved, payload)
    },
    safeRun,
  })

  const roomVocabularyService = new RoomVocabularyService({
    registry,
    getMembership: (playerId) => roomService.requireMembership(playerId),
    getHostRoom: (playerId) => roomService.requireHostRoom(playerId),
    getStore: getRoomVocabularyStore,
    addNotice: (room, text) => lifecycle(room).addSystemNotice(room, text),
    broadcastPresence,
    emitRoom,
    emitRoomEvent,
  })

  const gameplayService = new GameplayService({
    clock: runtime.clock,
    isOnline,
    requireHostRoom: (playerId) => roomService.requireHostRoom(playerId),
    requireMembership: (playerId) => roomService.requireMembership(playerId),
    requireGame,
    getRoomVocabularyStore,
    round: roundMachine,
    relay: relayMachine,
    emitRoom,
    snapshot: (room, playerId) => snapshotter.snapshot(room, playerId),
    isPlaying,
  })

  /**
   * 经典绘图目标：本回合画布。拒绝以返回值表达，错误码由 DrawingService 统一映射。
   */
  const resolveClassicDrawingSession = (
    playerId: string,
    roundId: string,
  ): DrawingTargetDecision => {
    const { player, room } = roomService.requireMembership(playerId)
    const game = room.game
    if (!game) return { accepted: false, reason: 'no-game' }
    if (room.phase !== 'drawing' || game.drawerId !== playerId || game.roundId !== roundId) {
      return { accepted: false, reason: 'not-drawer' }
    }
    if (isPhaseExpired(game, runtime.clock.now())) {
      return { accepted: false, reason: 'phase-expired' }
    }
    return {
      accepted: true,
      session: {
        player,
        canvas: game,
        roomId: room.id,
        gameId: game.id,
        roundId: game.roundId,
        markSynced: () => markAllSynced(room, game.lastSequence),
        refreshRoom: () => emitRoom(room.id),
      },
    }
  }

  /**
   * 接龙绘图目标：本棒的链画布。阶段过期检查与经典同口径（此前只在已废弃的旧实现里存在）。
   */
  const resolveRelayDrawingSession = (playerId: string, stepId: string): DrawingTargetDecision => {
    const { player, room } = roomService.requireMembership(playerId)
    const relay = room.relay
    if (!relay) return { accepted: false, reason: 'no-game' }
    const target = resolveRelayCanvasTarget({ phase: room.phase, relay }, playerId, stepId)
    if (!target.accepted) {
      switch (target.reason) {
        case 'stale-step':
          return { accepted: false, reason: 'stale-target' }
        case 'not-drawing-step':
          return { accepted: false, reason: 'not-drawer' }
        case 'not-participant':
          return { accepted: false, reason: 'not-participant' }
        case 'already-submitted':
          return { accepted: false, reason: 'already-submitted' }
      }
    }
    if (isPhaseExpired(relay, runtime.clock.now())) {
      return { accepted: false, reason: 'phase-expired' }
    }
    return {
      accepted: true,
      session: {
        player,
        canvas: target.value.canvas,
        roomId: room.id,
        gameId: relay.id,
        roundId: stepId,
        markSynced: () => undefined,
        refreshRoom: () => undefined,
      },
    }
  }

  const classicDrawing = new DrawingService({
    clock: runtime.clock,
    publisher: createRoomBroadcastPublisher({ emitRoomEvent }),
    resolveSession: resolveClassicDrawingSession,
  })

  const relayDrawing = new DrawingService({
    clock: runtime.clock,
    publisher: createSilentPublisher(),
    resolveSession: resolveRelayDrawingSession,
  })

  const relayService = new RelayService({
    clock: runtime.clock,
    relayMachine,
    relayDrawing,
    requireMembership: (playerId) => roomService.requireMembership(playerId),
    requireRelay,
  })

  const chatService = new ChatService({
    clock: runtime.clock,
    requireMembership: (playerId) => roomService.requireMembership(playerId),
    requirePlayer,
    requireGame,
    round: roundMachine,
    emitRoom,
    emitCanvasPing: (roomId, payload) =>
      io.to(roomId).emit(EVENTS.gameCanvasPing, createServerPush(EVENTS.gameCanvasPing, payload)),
  })

  // ── 7. 网关装配依赖（入口层照这一份挂载，不再自拼服务）─────────────────
  const gateways: WsGatewayDependencies = {
    session: { service: sessionService, publisher, clock: runtime.clock },
    room: { roomService, inviteService, vocabularyService: roomVocabularyService },
    drawing: { drawingService: classicDrawing, relayDrawingService: relayDrawing },
    chat: { chatService },
    gameplay: { gameplayService, roomService },
    relay: { relayService },
  }

  return {
    players,
    playersByTokenDigest,
    rooms,
    roomsByPrivateCode,
    invites,
    repositories,
    persistence,
    snapshotter,
    publisher,
    roundMachine,
    relayMachine,
    session: sessionService,
    room: roomService,
    gameplay: gameplayService,
    relay: relayService,
    chat: chatService,
    drawing: { classic: classicDrawing, relay: relayDrawing },
    invitation: inviteService,
    roomVocabulary: roomVocabularyService,
    gateways,
    emitRoom,
    broadcastPresence,
    requirePlayer,
    recoverOnStartup: () => sessionService.recoverOnStartup(),
  }
}
