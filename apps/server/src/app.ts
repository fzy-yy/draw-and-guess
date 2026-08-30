/**
 * HTTP 与 Socket.IO 适配层。
 * 本文件只执行输入 schema 校验、统一 ack 和领域服务调用，不在传输层自行裁决游戏状态。
 */
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import path from 'node:path'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { Server } from 'socket.io'
import { z, type ZodType } from 'zod'
import { APP_CONFIG, PUBLIC_CONFIG } from '../../../config.ts'
import {
  CreateRoomSchema,
  EVENTS,
  FillCommandSchema,
  JoinRoomSchema,
  ProfileSchema,
  RegisterSchema,
  RequestSchema,
  RoomSettingsSchema,
  StrokeSchema,
  type Ack,
} from '@draw-guess/shared'
import { failure, GameError, GameService, success, type RuntimeLogger } from './game-service.ts'
import { loadVocabulary, type VocabularyStore } from './vocabulary.ts'

export interface RunningApplication {
  httpServer: HttpServer
  io: Server
  service: GameService
}

/** 统一请求包装器：所有失败都以结构化 ack 返回，避免未捕获异常断开 Socket。 */
function bindRequest<T extends { requestId: string }, R>(
  socket: import('socket.io').Socket,
  event: string,
  schema: ZodType<T>,
  handler: (input: T, playerId: string) => R | Promise<R>,
  options: { registration?: boolean } = {},
): void {
  socket.on(event, async (raw: unknown, callback?: (ack: Ack<R>) => void) => {
    const provisionalId =
      typeof raw === 'object' && raw && 'requestId' in raw
        ? String((raw as { requestId: unknown }).requestId)
        : 'invalid-request'
    const respond = typeof callback === 'function' ? callback : () => undefined
    try {
      const input = schema.parse(raw)
      const playerId = socket.data.playerId as string | undefined
      if (!options.registration && !playerId)
        throw new GameError('UNAUTHORIZED', '请先确认玩家资料并登录')
      const cache = socket.data.requestCache as Map<string, unknown> | undefined
      if (cache?.has(input.requestId)) {
        respond(success(cache.get(input.requestId) as R, input.requestId))
        return
      }
      const result = await handler(input, playerId ?? '')
      if (cache) {
        cache.set(input.requestId, result)
        if (cache.size > 100) cache.delete(cache.keys().next().value as string)
      }
      respond(success(result, input.requestId))
    } catch (error) {
      const normalized =
        error instanceof z.ZodError
          ? new GameError('INVALID_PAYLOAD', '请求格式无效或字段超出允许范围')
          : error
      respond(failure(normalized, provisionalId) as Ack<R>)
    }
  })
}

/** 注册一个连接的全部协议事件，事件名只引用共享 EVENTS 常量。 */
function registerSocketHandlers(socket: import('socket.io').Socket, service: GameService): void {
  bindRequest(
    socket,
    EVENTS.sessionRegister,
    RegisterSchema,
    (input) => {
      const result = service.register(socket, input)
      socket.data.requestCache = service.players.get(result.player.id)?.requestCache
      socket.emit(EVENTS.sessionReady, result)
      socket.emit(EVENTS.presenceSnapshot, service.presenceSnapshot())
      const room = service.snapshotForPlayer(result.player.id)
      if (room) socket.emit(EVENTS.roomSnapshot, room)
      return result
    },
    { registration: true },
  )

  bindRequest(
    socket,
    EVENTS.sessionUpdateProfile,
    RequestSchema.extend({ profile: ProfileSchema }),
    (input, playerId) => service.updateProfile(playerId, input.profile),
  )
  bindRequest(
    socket,
    EVENTS.presenceUpdatePreferences,
    RequestSchema.extend({ discoverable: z.boolean(), acceptsInvites: z.boolean() }),
    (input, playerId) => service.updatePreferences(playerId, input),
  )
  bindRequest(
    socket,
    EVENTS.roomList,
    RequestSchema,
    (_input, _playerId) => service.presenceSnapshot().rooms,
  )
  bindRequest(socket, EVENTS.roomCreate, CreateRoomSchema, (input, playerId) =>
    service.createRoom(playerId, input),
  )
  bindRequest(socket, EVENTS.roomJoin, JoinRoomSchema, (input, playerId) =>
    service.joinRoom(playerId, input.roomId),
  )
  bindRequest(socket, EVENTS.roomLeave, RequestSchema, (_input, playerId) =>
    service.leaveRoom(playerId),
  )
  bindRequest(
    socket,
    EVENTS.roomSetReady,
    RequestSchema.extend({ ready: z.boolean() }),
    (input, playerId) => service.setReady(playerId, input.ready),
  )
  bindRequest(
    socket,
    EVENTS.roomUpdateSettings,
    RequestSchema.extend({
      patch: RoomSettingsSchema.partial(),
      expectedVersion: z.number().int().nonnegative(),
    }),
    (input, playerId) => service.updateSettings(playerId, input.patch, input.expectedVersion),
  )
  bindRequest(socket, EVENTS.roomGetVocabulary, RequestSchema, (_input, playerId) =>
    service.getVocabulary(playerId),
  )
  bindRequest(
    socket,
    EVENTS.roomUpdateVocabulary,
    RequestSchema.extend({
      ids: z.array(z.string()).max(2_000),
      expectedVersion: z.number().int().nonnegative(),
    }),
    (input, playerId) => service.updateVocabulary(playerId, input.ids, input.expectedVersion),
  )
  bindRequest(
    socket,
    EVENTS.roomKick,
    RequestSchema.extend({ targetId: z.string().uuid() }),
    (input, playerId) => service.kick(playerId, input.targetId),
  )
  bindRequest(
    socket,
    EVENTS.roomTransferHost,
    RequestSchema.extend({ targetId: z.string().uuid() }),
    (input, playerId) => service.transferHost(playerId, input.targetId),
  )
  bindRequest(
    socket,
    EVENTS.inviteSend,
    RequestSchema.extend({ targetId: z.string().uuid() }),
    (input, playerId) => service.sendInvite(playerId, input.targetId),
  )
  bindRequest(
    socket,
    EVENTS.inviteRespond,
    RequestSchema.extend({ inviteId: z.string().uuid(), accept: z.boolean() }),
    (input, playerId) => service.respondInvite(playerId, input.inviteId, input.accept),
  )
  bindRequest(
    socket,
    EVENTS.gameStart,
    RequestSchema.extend({ expectedVersion: z.number().int().nonnegative() }),
    (input, playerId) => service.startGame(playerId, input.expectedVersion),
  )
  bindRequest(
    socket,
    EVENTS.gameChooseWord,
    RequestSchema.extend({ roundId: z.string().uuid(), wordId: z.string() }),
    (input, playerId) => service.chooseWord(playerId, input.roundId, input.wordId),
  )
  bindRequest(
    socket,
    EVENTS.gamePauseRequest,
    RequestSchema.extend({ reason: z.string().max(40) }),
    (input, playerId) => service.pause(playerId, input.reason),
  )
  bindRequest(socket, EVENTS.gameResume, RequestSchema, (_input, playerId) =>
    service.resume(playerId),
  )
  bindRequest(socket, EVENTS.gameEndEarly, RequestSchema, (_input, playerId) =>
    service.endEarly(playerId),
  )
  bindRequest(socket, EVENTS.gameReturnWaiting, RequestSchema, (_input, playerId) =>
    service.returnWaiting(playerId),
  )
  bindRequest(
    socket,
    EVENTS.guessSubmit,
    RequestSchema.extend({
      roundId: z.string().uuid(),
      text: z.string().min(1).max(APP_CONFIG.player.chatMaxLength),
    }),
    (input, playerId) => service.submitGuess(playerId, input.roundId, input.text),
  )
  bindRequest(
    socket,
    EVENTS.chatPreset,
    RequestSchema.extend({ roundId: z.string().uuid(), preset: z.string() }),
    (input, playerId) => service.sendPreset(playerId, input.roundId, input.preset),
  )
  bindRequest(
    socket,
    EVENTS.drawStrokeBatch,
    RequestSchema.extend({ roundId: z.string().uuid(), stroke: StrokeSchema }),
    (input, playerId) => service.addStroke(playerId, input.roundId, input.stroke),
  )
  bindRequest(
    socket,
    EVENTS.drawFillCommit,
    RequestSchema.extend({ roundId: z.string().uuid(), fill: FillCommandSchema }),
    (input, playerId) => service.addFill(playerId, input.roundId, input.fill),
  )
  bindRequest(
    socket,
    EVENTS.drawUndo,
    RequestSchema.extend({ roundId: z.string().uuid() }),
    (input, playerId) => service.undo(playerId, input.roundId),
  )
  bindRequest(
    socket,
    EVENTS.drawRedo,
    RequestSchema.extend({ roundId: z.string().uuid() }),
    (input, playerId) => service.redo(playerId, input.roundId),
  )
  bindRequest(
    socket,
    EVENTS.drawClear,
    RequestSchema.extend({ roundId: z.string().uuid() }),
    (input, playerId) => service.clearDrawing(playerId, input.roundId),
  )
  bindRequest(socket, EVENTS.stateResync, RequestSchema, (_input, playerId) =>
    service.snapshotForPlayer(playerId),
  )
  bindRequest(
    socket,
    EVENTS.networkPing,
    RequestSchema.extend({ clientTime: z.number() }),
    (input) => ({ clientTime: input.clientTime, serverTime: Date.now() }),
  )

  socket.on('disconnect', () => service.handleDisconnect(socket))
}

/** 创建完整应用，并允许启动入口按部署环境注入公开地址和日志器。 */
export async function createApplication(
  options: {
    vocabulary?: VocabularyStore
    publicBaseUrl?: () => string
    logger?: RuntimeLogger
  } = {},
): Promise<RunningApplication> {
  const vocabulary = options.vocabulary ?? (await loadVocabulary())
  const app = express()
  const httpServer = createHttpServer(app)
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: false },
    maxHttpBufferSize: 128 * 1024,
    pingInterval: APP_CONFIG.network.pingIntervalMs,
    connectionStateRecovery: {
      maxDisconnectionDuration: APP_CONFIG.network.reconnectGraceMs,
      skipMiddlewares: false,
    },
  })
  const baseUrl = options.publicBaseUrl ?? (() => `http://localhost:${APP_CONFIG.network.port}`)
  const service = new GameService(io, vocabulary, options.logger)

  app.disable('x-powered-by')
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }))
  app.use(cors())
  app.use(express.json({ limit: '32kb' }))
  app.get('/api/health', (_request, response) =>
    response.json({
      ok: true,
      app: APP_CONFIG.app.name,
      version: APP_CONFIG.app.version,
      protocolVersion: APP_CONFIG.app.protocolVersion,
      vocabularyCount: vocabulary.items.length,
    }),
  )
  app.get('/api/info', (_request, response) =>
    response.json({ config: PUBLIC_CONFIG, serverTime: Date.now(), serverUrl: baseUrl() }),
  )
  const clientDist = path.resolve(process.cwd(), '../client/dist')
  app.use(express.static(clientDist))
  app.get(/^(?!\/api|\/socket\.io).*/, (_request, response) =>
    response.sendFile(path.join(clientDist, 'index.html')),
  )
  io.on('connection', (socket) => registerSocketHandlers(socket, service))
  return { httpServer, io, service }
}
