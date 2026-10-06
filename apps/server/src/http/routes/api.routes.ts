/**
 * 服务端系统 API 路由（/api/health 与 /api/info）。
 *
 * 遵循《后端架构规范》R3.2：
 * 入口层只做参数解析、调用领域服务/状态查询与结果响应，
 * 不内联任何复杂业务判定。
 */
import { Router } from 'express'
import { APP_CONFIG, PUBLIC_CONFIG } from '../../core/config.ts'
import type { OperationalMetrics } from '../../observability/metrics.ts'
import type { VocabularyRegistry } from '../../vocabulary/index.ts'

export interface ApiRoutesOptions {
  vocabulary: VocabularyRegistry
  metrics: OperationalMetrics
  getRoomCount: () => number
  healthMetricsEnabled?: boolean
  publicBaseUrl?: () => string
}

/** 详细运维指标只能从本机回环地址读取，且不信任可伪造的转发头 */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * 创建系统 API 路由。
 */
export function createApiRouter(options: ApiRoutesOptions): Router {
  const router = Router()
  const { vocabulary, metrics, getRoomCount, healthMetricsEnabled, publicBaseUrl } = options
  const baseUrl = publicBaseUrl ?? (() => `http://localhost:${APP_CONFIG.network.port}`)

  // 1. 健康检查路由
  router.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const summary = {
      ok: true,
      app: APP_CONFIG.app.name,
      version: APP_CONFIG.app.version,
      protocolVersion: APP_CONFIG.app.protocolVersion,
    }

    if (!healthMetricsEnabled || !isLoopbackAddress(req.socket.remoteAddress)) {
      res.json(summary)
      return
    }

    res.json({
      ...summary,
      details: {
        vocabularyCount: vocabulary.items.length,
        metrics: metrics.snapshot(getRoomCount()),
      },
    })
  })

  // 2. 服务端公开配置信息路由
  router.get('/info', (_req, res) => {
    res.json({
      config: PUBLIC_CONFIG,
      serverTime: Date.now(),
      serverUrl: baseUrl(),
    })
  })

  return router
}
