/**
 * HTTP 与 Socket.IO 适配层。
 * 本文件只负责端口/静态资源/Socket.IO 装配与统一连接入口；
 * 事件绑定与 schema 校验分别收敛到 handlers/* 与 protocol/binder.ts，
 * 领域服务调用仍由 GameService 承载，本层不裁决任何游戏状态。
 */
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { isIPv4 } from 'node:net'
import path from 'node:path'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@draw-guess/shared'
import { APP_CONFIG, PUBLIC_CONFIG } from './config/index.ts'
import { GameService } from './game-service.ts'
import type { RuntimeLogger } from './errors.ts'
import type { AppServer, AppSocket, AppSocketData, InterServerEvents } from './socket-types.ts'
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
import type { OperationalMetrics } from './observability/metrics.ts'

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const url = new URL(origin)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    // URL 对 IPv6 字面量会保留方括号（"[::1]"），先剥掉再做比较，否则 ::1 分支永远不命中。
    const hostname = url.hostname.replace(/^\[|\]$/gu, '')
    // 开发代理与局域网部署都需要跨端口访问，但只允许本地/私网浏览器来源；
    // 私网判定与 findLanAddresses 播报共用 isPrivateIpv4，避免「播报的地址」被 CORS 拒绝。
    // 私网来源必须先过 isIPv4 **字面量闸**：isPrivateIpv4 只按前缀匹配，单看前缀会把
    // `10.attacker.com`、`192.168.evil.com` 这类**域名**当成私网放行——恶意页面可用 DNS
    // rebinding 把自己的域名解析到受害者内网 IP，等于把局域网服务交给任意网页
    //（域名前缀像私网 ≠ 地址在私网）。取舍与完整论证见 docs/adr/0036-origin-private-ip-literal.md。
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      (isIPv4(hostname) && isPrivateIpv4(hostname))
    )
  } catch {
    return false
  }
}

/** 详细运维指标只能从本机回环地址读取，且不信任可伪造的转发头。 */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export interface RunningApplication {
  httpServer: HttpServer
  io: AppServer
  service: GameService
  metrics: OperationalMetrics
  /** 幂等关闭本应用拥有的 Socket、HTTP 与 SQLite 资源。 */
  close(): Promise<void>
}

/** 注册一个连接的全部协议事件：按领域分组挂载，并把服务挂到 socket.data 供日志回调使用。 */
function registerSocketHandlers(socket: AppSocket, service: GameService): void {
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
 * 业务规则读取公开配置包与服务端私有配置的组合视图（快照按观看者角色裁剪，计分级纯函数裁决）。
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
    /** 显式开启后仍只允许回环请求读取详细指标；默认仅返回安全摘要。 */
    healthMetricsEnabled?: boolean
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
  const io: AppServer = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    AppSocketData
  >(httpServer, {
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
  const metrics = service.metrics

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
  // 健康检查默认只返回安全摘要；详细指标必须显式开启且请求来自真实回环地址。
  app.get('/api/health', (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    const summary = {
      ok: true,
      app: APP_CONFIG.app.name,
      version: APP_CONFIG.app.version,
      protocolVersion: APP_CONFIG.app.protocolVersion,
    }
    if (!options.healthMetricsEnabled || !isLoopbackAddress(request.socket.remoteAddress)) {
      response.json(summary)
      return
    }
    response.json({
      ...summary,
      details: {
        vocabularyCount: vocabulary.items.length,
        metrics: metrics.snapshot(service.rooms.size),
      },
    })
  })
  // 信息接口：返回可公开配置与当前服务器地址，供客户端与调试工具使用
  app.get('/api/info', (_request, response) =>
    response.json({ config: PUBLIC_CONFIG, serverTime: Date.now(), serverUrl: baseUrl() }),
  )
  // 静态托管前端构建产物（生产模式由 pnpm start 拉起同一进程）。
  // 测试可注入 clientDist 指向本次构建到临时目录的产物；默认托管 ../client/dist。
  //
  // 缓存策略（阈值见 packages/config/src/settings.ts 的 performance）：
  // - /assets/** 的产物文件名由 Vite 写入内容哈希（name-<hash8>.ext），内容一变名字就变，
  //   因此可长缓存 + immutable，局域网重复进入时不再回源；
  // - 其余文件（index.html 等）用 no-cache，保证入口 HTML 每次校验，
  //   否则发新版本后浏览器会继续拿旧 HTML、引用已删除的旧哈希产物。
  const hashedAssetPattern = /\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/u
  const clientDist = options.clientDist ?? path.resolve(process.cwd(), '../client/dist')
  app.use(
    express.static(clientDist, {
      setHeaders: (response, filePath) => {
        // setHeaders 拿到的是平台原生路径（Windows 为反斜杠），统一成正斜杠再匹配
        const normalized = filePath.replace(/\\/gu, '/')
        response.setHeader(
          'Cache-Control',
          hashedAssetPattern.test(normalized)
            ? `public, max-age=${APP_CONFIG.performance.immutableAssetMaxAgeSeconds}, immutable`
            : 'no-cache',
        )
      },
    }),
  )
  // SPA 回退：非 API 非 Socket.IO 的路径统一返回 index.html（与静态托管的入口同样不缓存）
  app.get(/^(?!\/api|\/socket\.io).*/, (_request, response) => {
    response.setHeader('Cache-Control', 'no-cache')
    response.sendFile(path.join(clientDist, 'index.html'))
  })
  // 每个新连接注册全部协议事件处理器
  io.on('connection', (socket) => {
    metrics.connectionOpened()
    socket.once('disconnect', () => {
      metrics.connectionClosed()
    })
    registerSocketHandlers(socket, service)
  })

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

  return { httpServer, io, service, metrics, close }
}
