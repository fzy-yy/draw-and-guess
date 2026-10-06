/**
 * Express 5 HTTP 应用实例装配。
 *
 * 遵循《后端架构规范》R1.1 与 R3.2：
 * 1. 使用 Express 5（原生支持 async 异常转发至错误中间件）；
 * 2. 挂载 Helmet 安全头、CORS、Gzip 压缩；
 * 3. 挂载 API 子路由与前端静态资源托管（长缓存哈希文件，入口与 SPA 回退不缓存）；
 * 4. 挂载 RFC 9457 统一错误中间件作为最后一个中间件。
 */
import path from 'node:path'
import compression from 'compression'
import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { APP_CONFIG } from '../core/config.ts'
import { createErrorHandler } from './error-handler.ts'
import { createApiRouter } from './routes/api.routes.ts'
import { isPrivateIpv4Literal } from '../startup/lan-addresses.ts'
import type { OperationalMetrics } from '../observability/metrics.ts'
import type { VocabularyRegistry } from '../vocabulary/index.ts'
import type { RuntimeLogger } from '../core/errors.ts'

export interface CreateHttpAppOptions {
  clientDist: string
  localHostnames: readonly string[]
  vocabulary: VocabularyRegistry
  metrics: OperationalMetrics
  getRoomCount: () => number
  healthMetricsEnabled?: boolean
  publicBaseUrl?: () => string
  logger?: RuntimeLogger
}

/**
 * 跨域与来源安全校验：仅放行 localhost、环回地址、私网 IP 字面量及服务器自身计算机名。
 */
export function isAllowedOrigin(
  origin: string | undefined,
  allowedHostnames: readonly string[] = [],
): boolean {
  if (!origin) return true
  try {
    const url = new URL(origin)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    const hostname = url.hostname.replace(/^\[|\]$/gu, '')

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      isPrivateIpv4Literal(hostname)
    ) {
      return true
    }

    return allowedHostnames.some((name) => name.toLowerCase() === hostname)
  } catch {
    return false
  }
}

/**
 * 组装并配置 Express 5 HTTP 应用。
 */
export function createHttpApp(options: CreateHttpAppOptions): Express {
  const app = express()
  const { clientDist, localHostnames } = options

  app.disable('x-powered-by')

  // 1. 安全响应头配置（CSP）
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

  // 2. CORS 跨域白名单中间件
  app.use(
    cors({
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin, localHostnames)),
    }),
  )

  // 3. 静态内容 Gzip 压缩
  app.use(compression())

  // 4. API 子路由挂载
  const apiRouter = createApiRouter({
    vocabulary: options.vocabulary,
    metrics: options.metrics,
    getRoomCount: options.getRoomCount,
    healthMetricsEnabled: options.healthMetricsEnabled,
    publicBaseUrl: options.publicBaseUrl,
  })
  app.use('/api', apiRouter)

  // 5. 静态资源托管与精确缓存策略
  const hashedAssetPattern = /\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/u
  app.use(
    express.static(clientDist, {
      setHeaders: (response, filePath) => {
        const normalized = filePath.replace(/\\/gu, '/')
        response.setHeader(
          'Cache-Control',
          hashedAssetPattern.test(normalized)
            ? `public, max-age=${APP_CONFIG.staticAssets.immutableMaxAgeSeconds}, immutable`
            : 'no-cache',
        )
      },
    }),
  )

  // 6. SPA 路由回退：非 /api 与非 /socket.io 的路径回退到 index.html
  app.get(/^(?!\/api|\/socket\.io).*/, (_request, response) => {
    response.setHeader('Cache-Control', 'no-cache')
    response.sendFile(path.join(clientDist, 'index.html'))
  })

  // 7. 统一错误处理中间件
  app.use(createErrorHandler(options.logger))

  return app
}
