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
  options: { registration?: boolean; rateLimit?: boolean } = {},
): void {
  socket.on(event, async (raw: unknown, callback?: (ack: Ack<R>) => void) => {
    // 从原始载荷中尽量提取 requestId，保证报错时客户端仍能对上号
    const provisionalId =
      typeof raw === 'object' && raw && 'requestId' in raw
        ? String((raw as { requestId: unknown }).requestId)
        : 'invalid-request'
    const respond = typeof callback === 'function' ? callback : () => undefined
    // B2：会话级滑动窗口限频——每连接每秒最多 requestEventsPerSecond 个可失败请求，
    // 防止 createRoom/leaveRoom/stateResync 等高频刷包触发大面积广播。
    // 绘图类事件（draw:*）与 networkPing 例外：绘图已有 45/s 专用限频，避免误伤正常绘画。
    if (options.rateLimit !== false) {
      const now = Date.now()
      const history = ((socket.data.eventTimes as number[] | undefined) ?? []).filter(
        (time) => now - time < 1_000,
      )
      if (history.length >= APP_CONFIG.network.requestEventsPerSecond) {
        socket.data.eventTimes = history
        respond(
          failure(
            new GameError('RATE_LIMITED', '操作过于频繁，请稍后再试'),
            provisionalId,
          ) as Ack<R>,
        )
        return
      }
      history.push(now)
      socket.data.eventTimes = history
    }
    try {
      // 先做 schema 严格校验，非法载荷直接拒绝
      const input = schema.parse(raw)
      const playerId = socket.data.playerId as string | undefined
      // 除注册事件外，所有请求都必须已登录
      if (!options.registration && !playerId)
        throw new GameError('UNAUTHORIZED', '请先确认玩家资料并登录')
      // 幂等缓存：重复 requestId 直接返回上次结果，避免重复建房/计分
      const cache = socket.data.requestCache as Map<string, unknown> | undefined
      if (cache?.has(input.requestId)) {
        respond(success(cache.get(input.requestId) as R, input.requestId))
        return
      }
      const result = await handler(input, playerId ?? '')
      // 成功结果写入缓存，容量超过 100 条时逐出最早的记录
      if (cache) {
        cache.set(input.requestId, result)
        if (cache.size > 100) cache.delete(cache.keys().next().value as string)
      }
      respond(success(result, input.requestId))
    } catch (error) {
      // 把 zod 校验错误归一化为可读的 INVALID_PAYLOAD；其余业务错误原样处理
      const normalized =
        error instanceof z.ZodError
          ? new GameError('INVALID_PAYLOAD', '请求格式无效或字段超出允许范围')
          : error
      // C2：仅对非业务预期的内部错误记录脱敏日志，便于定位神秘 INTERNAL_ERROR
      if (!(normalized instanceof GameError) && !(error instanceof z.ZodError)) {
        ;(
          socket.data.service as
            { logUnexpectedError: (e: unknown, c: Record<string, unknown>) => void } | undefined
        )?.logUnexpectedError(error, { event })
      }
      respond(failure(normalized, provisionalId) as Ack<R>)
    }
  })
}

/** 注册一个连接的全部协议事件，事件名只引用共享 EVENTS 常量。 */
function registerSocketHandlers(socket: import('socket.io').Socket, service: GameService): void {
  // 把服务挂到 socket.data 上，供 bindRequest 的 catch 分支记录内部错误日志（C2）
  socket.data.service = service
  // 会话注册：校验协议版本，创建/恢复身份并返回 recoveryToken
  bindRequest(
    socket,
    EVENTS.sessionRegister,
    RegisterSchema,
    (input) => {
      const result = service.register(socket, input)
      // 把该玩家的幂等缓存挂到 socket 上，供后续请求复用
      socket.data.requestCache = service.players.get(result.player.id)?.requestCache
      // 注册成功后立即推送：身份、大厅状态、房间快照（若在房间中）
      socket.emit(EVENTS.sessionReady, result)
      socket.emit(EVENTS.presenceSnapshot, service.presenceSnapshot())
      const room = service.snapshotForPlayer(result.player.id)
      if (room) socket.emit(EVENTS.roomSnapshot, room)
      return result
    },
    { registration: true },
  )

  // 资料与偏好管理
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
  // 大厅只读查询
  bindRequest(
    socket,
    EVENTS.roomList,
    RequestSchema,
    (_input, _playerId) => service.presenceSnapshot().rooms,
  )
  // 房间生命周期：创建 / 加入 / 离开
  bindRequest(socket, EVENTS.roomCreate, CreateRoomSchema, (input, playerId) =>
    service.createRoom(playerId, input),
  )
  bindRequest(socket, EVENTS.roomJoin, JoinRoomSchema, (input, playerId) =>
    service.joinRoom(playerId, input.roomId),
  )
  bindRequest(socket, EVENTS.roomLeave, RequestSchema, (_input, playerId) =>
    service.leaveRoom(playerId),
  )
  // 房间规则：准备、改规则、词库管理
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
  // 房主管理：踢人 / 移交房主
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
  // 定向邀请：发送 / 应答
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
  // 对局控制：开始 / 选词 / 暂停 / 恢复 / 提前结束 / 返回房间
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
  // 猜词与聊天：提交猜词 / 发送安全预设短语
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
  // 绘图：笔画批次 / 区域填充 / 撤销 / 重做 / 清空（跳过通用限频，绘图有专用的 45/s 窗口限频）
  bindRequest(
    socket,
    EVENTS.drawStrokeBatch,
    RequestSchema.extend({ roundId: z.string().uuid(), stroke: StrokeSchema }),
    (input, playerId) => service.addStroke(playerId, input.roundId, input.stroke),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawFillCommit,
    RequestSchema.extend({ roundId: z.string().uuid(), fill: FillCommandSchema }),
    (input, playerId) => service.addFill(playerId, input.roundId, input.fill),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawUndo,
    RequestSchema.extend({ roundId: z.string().uuid() }),
    (input, playerId) => service.undo(playerId, input.roundId),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawRedo,
    RequestSchema.extend({ roundId: z.string().uuid() }),
    (input, playerId) => service.redo(playerId, input.roundId),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawClear,
    RequestSchema.extend({ roundId: z.string().uuid() }),
    (input, playerId) => service.clearDrawing(playerId, input.roundId),
    { rateLimit: false },
  )
  // 状态重同步：断线恢复后拉取权威快照
  bindRequest(socket, EVENTS.stateResync, RequestSchema, (_input, playerId) =>
    service.snapshotForPlayer(playerId),
  )
  // 网络检测：往返延迟估算（低频，无需限频）
  bindRequest(
    socket,
    EVENTS.networkPing,
    RequestSchema.extend({ clientTime: z.number() }),
    (input) => ({ clientTime: input.clientTime, serverTime: Date.now() }),
    { rateLimit: false },
  )

  // 连接断开：进入恢复宽限期，超时后释放身份与座位
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
  // Socket.IO 配置：允许任意源跨域、限制单包体积、配置心跳与连接状态恢复
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

  // 安全头与请求解析；CSP 由客户端自行管理，跨域资源策略关闭以便局域网访问
  app.disable('x-powered-by')
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }))
  app.use(cors())
  app.use(express.json({ limit: '32kb' }))
  // 健康检查：对外暴露服务名称、版本与词库规模
  app.get('/api/health', (_request, response) =>
    response.json({
      ok: true,
      app: APP_CONFIG.app.name,
      version: APP_CONFIG.app.version,
      protocolVersion: APP_CONFIG.app.protocolVersion,
      vocabularyCount: vocabulary.items.length,
    }),
  )
  // 信息接口：返回可公开配置与当前服务器地址，供客户端与调试工具使用
  app.get('/api/info', (_request, response) =>
    response.json({ config: PUBLIC_CONFIG, serverTime: Date.now(), serverUrl: baseUrl() }),
  )
  // 静态托管前端构建产物（生产模式由 pnpm start 拉起同一进程）
  const clientDist = path.resolve(process.cwd(), '../client/dist')
  app.use(express.static(clientDist))
  // SPA 回退：非 API 非 Socket.IO 的路径统一返回 index.html
  app.get(/^(?!\/api|\/socket\.io).*/, (_request, response) =>
    response.sendFile(path.join(clientDist, 'index.html')),
  )
  // 每个新连接注册全部协议事件处理器
  io.on('connection', (socket) => registerSocketHandlers(socket, service))
  return { httpServer, io, service }
}
