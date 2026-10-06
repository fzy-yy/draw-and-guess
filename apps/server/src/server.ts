/**
 * 服务端单一组合根（Composition Root）。
 *
 * 遵循《后端架构规范》§2.1、R4.8a 与 R4.8b：
 * 1. 全应用唯一允许出现 new 具体实现类与依赖装配的源文件；
 * 2. 纯构造函数显式注入，禁止全局可变单例与 DI 容器；
 * 3. 组合 Express HTTP 应用与 Socket.IO 服务；
 * 4. 导出 RunningApplication 实例及幂等 close() 资源释放逻辑。
 */
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import type { Express } from 'express'
import { Server } from 'socket.io'
import {
  EVENTS,
  createServerPush,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type ServerPushEnvelope,
  type ServerPushEventName,
} from '@draw-guess/shared'
import { GameService } from './game-service.ts'
import { APP_CONFIG } from './core/config.ts'
import { SILENT_LOGGER, runtimeErrorType, type RuntimeLogger } from './core/errors.ts'
import { SYSTEM_RUNTIME, type RuntimeDependencies } from './core/runtime.ts'
import { createDatabase, type DatabaseContext } from './infra/sqlite/connection.ts'
import { runMigrations } from './infra/sqlite/migrate.ts'
import { SqlitePlayerRepository } from './modules/session/session.repository.ts'
import { SqliteArchiveRepository } from './modules/archive/archive.repository.ts'
import { SessionService } from './modules/session/session.service.ts'
import { RoomService } from './modules/room/room.service.ts'
import { InviteService } from './modules/room/invite.service.ts'
import { RoomVocabularyService } from './modules/vocabulary/vocabulary.service.ts'
import {
  DrawingService,
  createRoomBroadcastPublisher,
  createSilentPublisher,
} from './modules/drawing/drawing.service.ts'
import { ChatService } from './modules/chat/chat.service.ts'
import { GameplayService } from './modules/gameplay/gameplay.service.ts'
import { RelayService } from './modules/relay/relay.service.ts'
import { ArchiveService } from './modules/archive/archive.service.ts'
import { RoundMachine } from './modules/gameplay/round-machine.ts'
import { RelayMachine } from './domain/relay/relay-machine.ts'
import { SnapshotBuilder } from './snapshot.ts'
import { RoomPublisher } from './application/room-publisher.ts'
import { DomainContext } from './domain/domain-context.ts'
import { createHttpApp, isAllowedOrigin } from './http/app.ts'
import { registerAllGateways } from './ws/gateway.ts'
import type { AppServer, AppSocketData, InterServerEvents } from './ws/contracts.ts'
import { OperationalMetrics } from './observability/metrics.ts'
import { loadVocabulary, type VocabularyRegistry } from './vocabulary/index.ts'
import { findLocalHostnames } from './startup/local-hostnames.ts'
import { createOnlineLookup, isPhaseExpired } from './domain/room/member-facts.ts'
import { isInMatchPhase } from './domain/room/phase-facts.ts'
import { resolveRelayCanvasTarget } from './domain/relay/relay-canvas-target.ts'
import { markAllSynced } from './modules/drawing/canvas-sync.ts'
import type { RoomSecret, PlayerSecret, GameSecret } from './models.ts'
import type { RelayGameSecret } from './domain/relay/relay-models.ts'

/**
 * 运行中应用实例封装。
 */
export interface RunningApplication {
  readonly app: Express
  readonly httpServer: HttpServer
  readonly io: AppServer
  readonly database: DatabaseContext
  readonly metrics: OperationalMetrics
  readonly service: GameService
  readonly close: () => Promise<void>
}

export interface CreateApplicationOptions {
  vocabulary?: VocabularyRegistry
  publicBaseUrl?: () => string
  logger?: RuntimeLogger
  dbFile?: string
  clientDist: string
  healthMetricsEnabled?: boolean
  localHostnames?: readonly string[]
  runtime?: RuntimeDependencies
}

/**
 * 创建并装配运行中应用程序。
 */
export async function createApplication(
  options: CreateApplicationOptions,
): Promise<RunningApplication> {
  const logger = options.logger ?? SILENT_LOGGER
  const runtime = options.runtime ?? SYSTEM_RUNTIME
  const metrics = new OperationalMetrics()
  const vocabulary = options.vocabulary ?? (await loadVocabulary())

  // 1. 初始化 SQLite 数据库与语句缓存并运行迁移
  const database = createDatabase(options.dbFile)
  try {
    runMigrations(database)
  } catch (error) {
    database.close()
    throw error
  }

  // 2. 仓储层实例化
  const repositories = {
    players: new SqlitePlayerRepository(database),
    archive: new SqliteArchiveRepository(database),
  }

  // 3. 内存聚合上下文实例化
  const domain = new DomainContext()
  const { players, playersByTokenDigest, rooms, roomsByPrivateCode, invites } = domain
  const isOnline = createOnlineLookup(players)

  // 4. 初始化底层 HTTP Server 与 Socket.IO Server
  const localHostnames = options.localHostnames ?? findLocalHostnames()
  const app = createHttpApp({
    clientDist: options.clientDist,
    localHostnames,
    vocabulary,
    metrics,
    getRoomCount: () => rooms.size,
    healthMetricsEnabled: options.healthMetricsEnabled,
    publicBaseUrl: options.publicBaseUrl,
    logger,
  })

  const httpServer = createHttpServer(app)
  const io: AppServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    AppSocketData
  >(httpServer, {
    allowRequest: (request, callback) =>
      callback(null, isAllowedOrigin(request.headers.origin, localHostnames)),
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin, localHostnames)),
      credentials: false,
    },
    maxHttpBufferSize: APP_CONFIG.network.maxHttpBufferBytes,
    pingInterval: APP_CONFIG.network.pingIntervalMs,
  })

  // 辅助发射与状态断言函数
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

  const requirePlayer = (playerId: string): PlayerSecret => {
    const player = players.get(playerId)
    if (!player) throw new Error('UNAUTHORIZED')
    return player
  }

  const requireGame = (room: RoomSecret): GameSecret => {
    if (!room.game) throw new Error('NO_GAME')
    return room.game
  }

  const requireRelay = (room: RoomSecret): RelayGameSecret => {
    if (!room.relay) throw new Error('NO_GAME')
    return room.relay
  }

  const isPlaying = (phase: string): boolean => {
    return isInMatchPhase(phase as never)
  }

  const getRoomVocabularyStore = (room?: RoomSecret) => {
    if (room?.vocabularyPackageId) {
      const store = vocabulary.get(room.vocabularyPackageId)
      if (store) return store
    }
    return vocabulary.getDefault()
  }

  // 5. 跨模块服务依赖构造
  const archiveService = new ArchiveService(repositories.archive, logger)

  const snapshotter = new SnapshotBuilder({
    players,
    rooms,
    clock: runtime.clock,
    isPlaying,
    getRoomVocabularyStore,
    requirePlayer,
  })

  const publisher = new RoomPublisher({
    io,
    rooms,
    players,
    snapshot: (room, viewerId, opts) => snapshotter.snapshot(room, viewerId, opts),
    toPublicPlayer: (player) => snapshotter.toPublicPlayer(player),
    toPublicRoom: (room) => snapshotter.toPublicRoom(room),
    logError: (err, ctx) =>
      logger.error({ ...ctx, errorType: runtimeErrorType(err) }, '未预期的服务器内部错误'),
  })

  const emitRoom = (roomId: string): void => publisher.emitRoom(roomId)
  const broadcastPresence = (): void => publisher.broadcastPresence()

  // 状态机装配
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
    persistGameResult: (room, reason) => {
      const game = room.game
      if (game?.finalRanking) {
        archiveService.archiveGame(
          {
            id: game.id,
            roomId: room.id,
            startedAt: game.startedAt,
            finishedAt: runtime.clock.now(),
            totalRounds: game.totalRounds,
            finalRanking: JSON.stringify(game.finalRanking),
            reason,
            mode: room.gameMode,
          },
          game.finalRanking.map((entry) => ({
            gameId: game.id,
            playerId: entry.id,
            nickname: entry.nickname,
            avatarId: entry.avatarId,
            rank: entry.rank,
            score: entry.score,
            stats: JSON.stringify(entry.stats),
          })),
        )
      }
    },
    safeRun: (label, fn) => {
      try {
        fn()
      } catch (err) {
        logger.error({ errorType: runtimeErrorType(err), label }, '未预期的服务器内部错误')
      }
    },
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
    persistGameResult: (room, reason) => {
      const relay = room.relay
      if (relay?.finalRanking) {
        archiveService.archiveGame(
          {
            id: relay.id,
            roomId: room.id,
            startedAt: relay.startedAt,
            finishedAt: runtime.clock.now(),
            totalRounds: relay.chains.length,
            finalRanking: JSON.stringify(relay.finalRanking),
            reason,
            mode: room.gameMode,
          },
          relay.finalRanking.map((entry) => ({
            gameId: relay.id,
            playerId: entry.id,
            nickname: entry.nickname,
            avatarId: entry.avatarId,
            rank: entry.rank,
            score: entry.score,
            stats: '{}',
          })),
        )
      }
    },
    setWaiting: (room, notice) => {
      roundMachine.setWaiting(room, notice)
    },
    safeRun: (label, fn) => {
      try {
        fn()
      } catch (err) {
        logger.error({ errorType: runtimeErrorType(err), label }, '未预期的服务器内部错误')
      }
    },
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
    emitRoomEvent: (roomId, ev, env) => emitRoomEvent(roomId, ev, env),
    emitRoomEventExcept: (roomId, exceptId, ev, env) =>
      emitRoomEventExcept(roomId, exceptId, ev, env),
    toPublicPlayer: (player) => snapshotter.toPublicPlayer(player),
    finishRound: (room, drawerAbandoned) => roundMachine.finishRound(room, drawerAbandoned),
    leaveRoom: (playerId, reason) => roomService.leaveRoom(playerId, reason),
    persistPlayer: (player) =>
      repositories.players.upsert({
        id: player.id,
        tokenDigest: player.tokenDigest,
        nickname: player.profile.nickname,
        avatarId: player.profile.avatarId,
        discoverable: player.preferences.discoverable,
        acceptsInvites: player.preferences.acceptsInvites,
        connected: player.connected,
        joinedAt: player.joinedAt,
        disconnectedAt: player.disconnectedAt,
      }),
    transferDisconnectedHost: (room, pId) => roomService.transferDisconnectedHost(room, pId),
    safeRun: (label, fn) => {
      try {
        fn()
      } catch (err) {
        logger.error({ errorType: runtimeErrorType(err), label }, '未预期的服务器内部错误')
      }
    },
  })

  const roomService = new RoomService({
    clock: runtime.clock,
    random: runtime.random,
    scheduler: runtime.scheduler,
    logger,
    players,
    rooms,
    roomsByPrivateCode,
    vocabulary,
    requirePlayer,
    broadcastPresence,
    emitRoom,
    emitRoomEvent,
    emitToPlayer,
    snapshot: (room, pId) => snapshotter.snapshot(room, pId),
    transition: (room, next) => {
      if (room.gameMode === 'relay') relayMachine.transition(room, next)
      else roundMachine.transition(room, next)
    },
    invalidateReady: (room, notice) => {
      if (room.gameMode === 'relay') relayMachine.invalidateReady(room, notice)
      else roundMachine.invalidateReady(room, notice)
    },
    setWaiting: (room, notice, resetReady) => {
      relayMachine.discard(room)
      roundMachine.setWaiting(room, notice, resetReady)
    },
    evaluateRematch: (room) => {
      if (room.gameMode === 'relay') relayMachine.evaluateRematch(room)
      else roundMachine.evaluateRematch(room)
    },
    finishRound: (room, drawerAbandoned) => roundMachine.finishRound(room, drawerAbandoned),
    abandonChoosing: (room, notice) => roundMachine.abandonChoosing(room, notice),
    addSystemNotice: (room, text) => {
      if (room.gameMode === 'relay') relayMachine.addSystemNotice(room, text)
      else roundMachine.addSystemNotice(room, text)
    },
    clearHintTimers: (game) => roundMachine.clearHintTimers(game),
    getRoomVocabularyStore,
    isPlaying,
  })

  const inviteService = new InviteService({
    clock: runtime.clock,
    random: runtime.random,
    scheduler: runtime.scheduler,
    invites,
    getMembership: (pId) => roomService.requireMembership(pId),
    getPlayer: requirePlayer,
    getRoom: (rId) => rooms.get(rId),
    join: (pId, room) => roomService.joinResolvedRoom(requirePlayer(pId), room, 'invite'),
    toPublicInvite: (invite) => {
      const room = rooms.get(invite.roomId)
      return {
        id: invite.id,
        roomId: invite.roomId,
        roomName: room?.name ?? '',
        from: snapshotter.toPublicPlayer(requirePlayer(invite.fromPlayerId)),
        expiresAt: invite.expiresAt,
      }
    },
    emitInvite: (target, publicInvite) => {
      target.socket?.emit(
        EVENTS.inviteReceived,
        createServerPush(EVENTS.inviteReceived, publicInvite),
      )
    },
    emitResolved: (_invite, id, status) => {
      io.emit(EVENTS.inviteResolved, createServerPush(EVENTS.inviteResolved, { id, status }))
    },
    safeRun: (label, fn) => {
      try {
        fn()
      } catch (err) {
        logger.error({ errorType: runtimeErrorType(err), label }, '未预期的服务器内部错误')
      }
    },
  })

  const vocabularyService = new RoomVocabularyService({
    registry: vocabulary,
    getMembership: (pId) => roomService.requireMembership(pId),
    getHostRoom: (pId) => roomService.requireHostRoom(pId),
    getStore: getRoomVocabularyStore,
    addNotice: (room, text) => {
      if (room.gameMode === 'relay') relayMachine.addSystemNotice(room, text)
      else roundMachine.addSystemNotice(room, text)
    },
    broadcastPresence,
    emitRoom,
    emitRoomEvent,
  })

  const drawingService = new DrawingService({
    clock: runtime.clock,
    publisher: createRoomBroadcastPublisher({ emitRoomEvent }),
    getSession: (playerId, roundId) => {
      const { player, room } = roomService.requireMembership(playerId)
      const game = requireGame(room)
      if (room.phase !== 'drawing' || game.drawerId !== playerId || game.roundId !== roundId) {
        throw new Error('NOT_DRAWER')
      }
      if (isPhaseExpired(game, runtime.clock.now())) {
        throw new Error('PHASE_EXPIRED')
      }
      return {
        player,
        canvas: game,
        roomId: room.id,
        gameId: game.id,
        roundId: game.roundId,
        markSynced: () => markAllSynced(room, game.lastSequence),
        refreshRoom: () => emitRoom(room.id),
      }
    },
  })

  const relayDrawingService = new DrawingService({
    clock: runtime.clock,
    publisher: createSilentPublisher(),
    getSession: (playerId, stepId) => {
      const { player, room } = roomService.requireMembership(playerId)
      const relay = requireRelay(room)
      const target = resolveRelayCanvasTarget({ phase: room.phase, relay }, playerId, stepId)
      if (!target.accepted) {
        throw new Error(target.reason)
      }
      return {
        player,
        canvas: target.value.canvas,
        roomId: room.id,
        gameId: relay.id,
        roundId: stepId,
        markSynced: () => {},
        refreshRoom: () => {},
      }
    },
  })

  const chatService = new ChatService({
    clock: runtime.clock,
    requireMembership: (pId) => roomService.requireMembership(pId),
    requirePlayer,
    requireGame,
    round: roundMachine,
    emitRoom,
    emitCanvasPing: (roomId, payload) =>
      io.to(roomId).emit(EVENTS.gameCanvasPing, createServerPush(EVENTS.gameCanvasPing, payload)),
  })

  const gameplayService = new GameplayService({
    clock: runtime.clock,
    isOnline,
    requireHostRoom: (pId) => roomService.requireHostRoom(pId),
    requireMembership: (pId) => roomService.requireMembership(pId),
    requireGame,
    getRoomVocabularyStore,
    round: roundMachine,
    relay: relayMachine,
    emitRoom,
    snapshot: (room, pId) => snapshotter.snapshot(room, pId),
    isPlaying,
  })

  const relayService = new RelayService({
    clock: runtime.clock,
    relayMachine,
    relayDrawing: relayDrawingService,
    requireMembership: (pId) => roomService.requireMembership(pId),
    requireRelay,
  })

  // 6. Socket.IO 连接事件与网关挂载
  io.on('connection', (socket) => {
    metrics.connectionOpened()
    socket.once('disconnect', () => {
      metrics.connectionClosed()
    })

    socket.data.service = {
      clock: runtime.clock,
      metrics,
      logUnexpectedError: (err, ctx) =>
        logger.error({ ...ctx, errorType: runtimeErrorType(err) }, '未预期的服务器内部错误'),
    }
    socket.data.requestCache = new Map()
    socket.data.inFlightRequests = new Map()

    registerAllGateways(socket, {
      session: { service: sessionService, publisher, clock: runtime.clock },
      room: { roomService, inviteService, vocabularyService },
      drawing: { drawingService, relayDrawingService },
      chat: { chatService },
      gameplay: { gameplayService, roomService },
      relay: { relayService },
    })
  })

  // 7. 启动恢复已持久化的玩家
  sessionService.recoverOnStartup()

  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      try {
        await new Promise<void>((resolve) => io.close(() => resolve()))
        if (httpServer.listening) {
          await new Promise<void>((resolve, reject) =>
            httpServer.close((error) => (error ? reject(error) : resolve())),
          )
        }
      } finally {
        database.close()
      }
    })()
    return closePromise
  }

  const service = new GameService(io, vocabulary, repositories, logger, runtime, metrics)

  return {
    app,
    httpServer,
    io,
    database,
    metrics,
    service,
    close,
  }
}
