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
import { APP_CONFIG, PUBLIC_CONFIG } from './config/index.ts'
import { GameService } from './game-service.ts'
import type { RuntimeLogger } from './errors.ts'
import { loadVocabulary, type VocabularyRegistry } from './vocabulary/index.ts'
import { isPrivateIpv4 } from './startup/lan-addresses.ts'
import { registerSessionHandlers } from './handlers/session.ts'
import { registerRoomHandlers } from './handlers/room.ts'
import { registerGameHandlers } from './handlers/game.ts'
import { registerChatHandlers } from './handlers/chat.ts'
import { registerDrawHandlers } from './handlers/draw.ts'
import { SqlitePlayerRepository } from './repositories/player-repository.ts'
import { SqliteArchiveRepository } from './repositories/archive-repository.ts'
import { createDatabase } from './db/index.ts'
import { runMigrations } from './db/migrate.ts'

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const url = new URL(origin)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    // URL 对 IPv6 字面量会保留方括号（"[::1]"），先剥掉再做比较，否则 ::1 分支永远不命中。
    const hostname = url.hostname.replace(/^\[|\]$/gu, '')
    // 开发代理与局域网部署都需要跨端口访问，但只允许本地/私网浏览器来源；
    // 私网判定与 findLanAddresses 播报共用 isPrivateIpv4，避免「播报的地址」被 CORS 拒绝。
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      isPrivateIpv4(hostname)
    )
  } catch {
    return false
  }
}

export interface RunningApplication {
  httpServer: HttpServer
  io: Server
  service: GameService
  /** 幂等关闭本应用拥有的 Socket、HTTP 与 SQLite 资源。 */
  close(): Promise<void>
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

/**
 * 创建完整应用，并允许启动入口按部署环境注入公开地址、日志器、数据库路径与前端产物目录。
 *
 * 注入项均为「基础设施」参数：dbFile / clientDist 仅供测试或嵌入场景指向隔离目录，
 * 生产路径保持默认（apps/server/data/game.db 与 ../client/dist）；本文件不承载任何业务规则，
 * 业务规则读取公开配置包与服务端私有配置的组合视图（按 ROLE 裁剪的快照与计分逻辑不变）。
 */
export async function createApplication(
  options: {
    vocabulary?: VocabularyRegistry
    publicBaseUrl?: () => string
    logger?: RuntimeLogger
    /** 测试隔离用：把 SQLite 数据文件指向临时目录，避免污染真实 game.db。 */
    dbFile?: string
    /** 测试隔离用：托管前端构建产物的目录，避免依赖恰好存在的 dist。 */
    clientDist?: string
  } = {},
): Promise<RunningApplication> {
  const vocabulary = options.vocabulary ?? (await loadVocabulary())
  // 每个应用实例拥有独立数据库上下文；迁移、仓储和事务都绑定到这一连接。
  const database = createDatabase(options.dbFile)
  try {
    runMigrations(database)
  } catch (error) {
    database.close()
    throw error
  }
  const app = express()
  const httpServer = createHttpServer(app)
  // Socket.IO 只负责传输重连；身份、业务房间与遗漏画布一律由秘密令牌 + 权威全量快照恢复。
  // 不启用 connectionStateRecovery：它会在应用层注册校验前恢复旧 socket.rooms 并重放消息，
  // 导致已经被领域层移出房间的身份仍短暂收到旧房间数据，形成跨房间状态与隐私风险。
  const io = new Server(httpServer, {
    // CORS 只约束浏览器的 HTTP 响应；allowRequest 同步覆盖 polling 与 WebSocket 握手入口。
    allowRequest: (request, callback) => callback(null, isAllowedOrigin(request.headers.origin)),
    cors: {
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      credentials: false,
    },
    maxHttpBufferSize: 128 * 1024,
    pingInterval: APP_CONFIG.network.pingIntervalMs,
  })
  const baseUrl = options.publicBaseUrl ?? (() => `http://localhost:${APP_CONFIG.network.port}`)
  // 仅持久化短期身份与完成局战报；运行中房间始终是进程内权威状态。
  const repositories = {
    players: new SqlitePlayerRepository(database),
    archive: new SqliteArchiveRepository(database),
  }
  const service = new GameService(io, vocabulary, repositories, options.logger)

  // CSP 只开放生产产物实际需要的来源；纯 HTTP 局域网部署明确不升级 HTTPS、不发送 HSTS。
  app.disable('x-powered-by')
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'", 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'data:', 'blob:'],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          styleSrcAttr: ["'unsafe-inline'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginResourcePolicy: false,
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
      hsts: false,
    }),
  )
  app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin)) }))
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
  // 静态托管前端构建产物（生产模式由 pnpm start 拉起同一进程）。
  // 测试可注入 clientDist 指向本次构建到临时目录的产物；默认托管 ../client/dist。
  const clientDist = options.clientDist ?? path.resolve(process.cwd(), '../client/dist')
  app.use(express.static(clientDist))
  // SPA 回退：非 API 非 Socket.IO 的路径统一返回 index.html
  app.get(/^(?!\/api|\/socket\.io).*/, (_request, response) =>
    response.sendFile(path.join(clientDist, 'index.html')),
  )
  // 每个新连接注册全部协议事件处理器
  io.on('connection', (socket) => registerSocketHandlers(socket, service))

  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      try {
        io.disconnectSockets(true)
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

  return { httpServer, io, service, close }
}
