/**
 * 服务端入口装配：HTTP / Socket.IO / 数据库生命周期。
 *
 * 遵循《后端架构规范》§2.1、R4.8a 与 R4.8b：
 * 1. 业务世界的装配唯一归 `backend.ts`（`createBackend`，见 docs/adr/0064-single-backend-assembly.md）；
 *    本文件只起端口、建连、把网关挂到每条连接上，并按相反顺序释放资源；
 * 2. 纯构造函数显式注入，禁止全局可变单例与 DI 容器；
 * 3. 关闭是幂等的：先停 Socket.IO 与 HTTP，最后关数据库。
 */
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import type { Express } from 'express'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@draw-guess/shared'
import { createBackend, type Backend } from './backend.ts'
import { APP_CONFIG } from './core/config.ts'
import { SILENT_LOGGER, runtimeErrorType, type RuntimeLogger } from './core/errors.ts'
import { SYSTEM_RUNTIME, type RuntimeDependencies } from './runtime.ts'
import { createDatabase, type DatabaseContext } from './infra/sqlite/connection.ts'
import { runMigrations } from './infra/sqlite/migrate.ts'
import { SqlitePlayerRepository } from './modules/session/session.repository.ts'
import { SqliteArchiveRepository } from './modules/archive/archive.repository.ts'
import { createHttpApp, isAllowedOrigin } from './http/app.ts'
import { registerAllGateways } from './ws/gateway.ts'
import type { AppServer, AppSocketData, InterServerEvents } from './socket-types.ts'
import { OperationalMetrics } from './observability/metrics.ts'
import { loadVocabulary, type VocabularyRegistry } from './vocabulary/index.ts'
import { findLocalHostnames } from './startup/local-hostnames.ts'

/**
 * 运行中应用实例封装。
 */
export interface RunningApplication {
  readonly app: Express
  readonly httpServer: HttpServer
  readonly io: AppServer
  readonly database: DatabaseContext
  readonly metrics: OperationalMetrics
  /** 业务世界：唯一装配根产出的服务集合（测试与入口都经它访问领域）。 */
  readonly backend: Backend
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

  // 3. HTTP 与 Socket.IO 传输层
  const localHostnames = options.localHostnames ?? findLocalHostnames()
  const app = createHttpApp({
    clientDist: options.clientDist,
    localHostnames,
    vocabulary,
    metrics,
    getRoomCount: () => backend.rooms.size,
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

  // 4. 业务世界：唯一装配根（依赖 io，故在传输层之后构造）
  const backend = createBackend({ io, vocabulary, repositories, logger, runtime })

  // 5. 每条连接的会话状态与网关挂载
  io.on('connection', (socket) => {
    metrics.connectionOpened()
    socket.once('disconnect', () => {
      metrics.connectionClosed()
    })

    socket.data.service = {
      clock: runtime.clock,
      metrics,
      logUnexpectedError: (err, context) =>
        logger.error({ ...context, errorType: runtimeErrorType(err) }, '未预期的服务器内部错误'),
    }
    socket.data.requestCache = new Map()
    socket.data.inFlightRequests = new Map()

    registerAllGateways(socket, backend.gateways)
  })

  // 6. 幂等关闭：先停连接与监听，最后关数据库
  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      try {
        await new Promise<void>((resolve) => io.close(() => resolve()))
        if (httpServer.listening) {
          await new Promise<void>((resolve, reject) => {
            httpServer.close((error) => (error ? reject(error) : resolve()))
          })
        }
      } finally {
        database.close()
      }
    })()
    return closePromise
  }

  return {
    app,
    httpServer,
    io,
    database,
    metrics,
    backend,
    close,
  }
}
