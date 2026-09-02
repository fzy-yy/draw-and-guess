/**
 * HTTP 与 Socket.IO 适配层。
 * 本文件只负责端口/静态资源/Socket.IO 装配与统一连接入口；
 * 事件绑定与 schema 校验分别收敛到 handlers/* 与 protocol/binder.ts，
 * 领域服务调用仍由 GameService 承载，本层不裁决任何游戏状态。
 */
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import path from 'node:path'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { Server } from 'socket.io'
import { APP_CONFIG, PUBLIC_CONFIG } from '../../../config.ts'
import { GameService } from './game-service.ts'
import type { RuntimeLogger } from './errors.ts'
import { loadVocabulary, type VocabularyStore } from './vocabulary.ts'
import { registerSessionHandlers } from './handlers/session.ts'
import { registerRoomHandlers } from './handlers/room.ts'
import { registerGameHandlers } from './handlers/game.ts'
import { registerChatHandlers } from './handlers/chat.ts'
import { registerDrawHandlers } from './handlers/draw.ts'
import { SqlitePlayerRepository } from './repositories/player-repository.ts'
import { SqliteRoomRepository } from './repositories/room-repository.ts'
import { SqliteArchiveRepository } from './repositories/archive-repository.ts'
import { runMigrations } from './db/migrate.ts'

export interface RunningApplication {
  httpServer: HttpServer
  io: Server
  service: GameService
}

/** 注册一个连接的全部协议事件：按领域分组挂载，并把服务挂到 socket.data 供日志回调使用。 */
function registerSocketHandlers(socket: import('socket.io').Socket, service: GameService): void {
  // 注册前即初始化幂等缓存与并发请求表，保证首次 session:register 也不会重复执行。
  socket.data.service = service
  socket.data.requestCache = new Map()
  socket.data.inFlightRequests = new Map()
  registerSessionHandlers(socket, service)
  registerRoomHandlers(socket, service)
  registerGameHandlers(socket, service)
  registerChatHandlers(socket, service)
  registerDrawHandlers(socket, service)
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
  // 建库并执行迁移（幂等）：首次启动建全部表，升级时应用新增迁移。
  runMigrations()
  const app = express()
  const httpServer = createHttpServer(app)
  // Socket.IO 只负责传输重连；身份、业务房间与遗漏画布一律由秘密令牌 + 权威全量快照恢复。
  // 不启用 connectionStateRecovery：它会在应用层注册校验前恢复旧 socket.rooms 并重放消息，
  // 导致已经被领域层移出房间的身份仍短暂收到旧房间数据，形成跨房间状态与隐私风险。
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: false },
    maxHttpBufferSize: 128 * 1024,
    pingInterval: APP_CONFIG.network.pingIntervalMs,
  })
  const baseUrl = options.publicBaseUrl ?? (() => `http://localhost:${APP_CONFIG.network.port}`)
  // 持久化仓储：SQLite 实现，注入领域服务（领域层只依赖接口，便于测试换内存实现）。
  const repositories = {
    players: new SqlitePlayerRepository(),
    rooms: new SqliteRoomRepository(),
    archive: new SqliteArchiveRepository(),
  }
  const service = new GameService(io, vocabulary, repositories, options.logger)

  // 安全头与请求解析；CSP 由客户端自行管理，跨域资源策略关闭以便局域网访问
  app.disable('x-powered-by')
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }))
  app.use(cors())
  app.use(express.json({ limit: '32kb' }))
  // 静态资源 gzip 压缩：JS/CSS/SVG 经 compression 减小传输体积，对局域网也有明显收益。
  // 放在静态托管前，仅对可压缩内容（text/javascript/css/svg 等）生效。
  app.use(compression())
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
