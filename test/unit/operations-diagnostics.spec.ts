import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_REQUEST_SCHEMAS, EVENTS, StateResyncSchema, type Ack } from '@draw-guess/shared'
import { createApplication, isLoopbackAddress } from '../../apps/server/src/app.ts'
import { getDeploymentConfig } from '../../apps/server/src/config/index.ts'
import { GameError, SILENT_LOGGER, type RuntimeLogger } from '../../apps/server/src/errors.ts'
import { makeLogger } from '../../apps/server/src/logging/file-logger.ts'
import { OperationalMetrics } from '../../apps/server/src/observability/metrics.ts'
import { bindRequest } from '../../apps/server/src/protocol/binder.ts'
import { shutdownApplication } from '../../apps/server/src/startup/shutdown.ts'
import { createMemoryVocabularyRegistry } from './helpers/mini-vocabulary.ts'

const temporaryDirectories: string[] = []
const applications: Array<Awaited<ReturnType<typeof createApplication>>> = []

afterEach(async () => {
  await Promise.all(applications.splice(0).map((application) => application.close()))
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'draw-guess-operations-'))
  temporaryDirectories.push(directory)
  return directory
}

function deployment(logLevel: 'debug' | 'info' | 'warn' | 'error') {
  return getDeploymentConfig({
    PORT: '5174',
    LOG_ENABLED: 'true',
    LOG_LEVEL: logLevel,
    LOG_MAX_FILES: '2',
  })
}

function mockLogger(order: string[] = []): RuntimeLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    flush: vi.fn(async () => void order.push('flush')),
    close: vi.fn(async () => void order.push('logger-close')),
    flushSync: vi.fn(() => void order.push('flush-sync')),
  }
}

async function listen(application: Awaited<ReturnType<typeof createApplication>>): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    application.httpServer.once('error', reject)
    application.httpServer.listen(0, '127.0.0.1', () => {
      application.httpServer.off('error', reject)
      resolve()
    })
  })
  const address = application.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('测试服务未取得监听端口')
  return `http://127.0.0.1:${address.port}`
}

async function applicationWithHealthDetails(enabled: boolean) {
  const root = temporaryDirectory()
  const clientDist = join(root, 'dist')
  mkdirSync(clientDist)
  writeFileSync(join(clientDist, 'index.html'), '<!doctype html><title>test</title>')
  const application = await createApplication({
    clientDist,
    dbFile: join(root, 'game.db'),
    healthMetricsEnabled: enabled,
    logger: SILENT_LOGGER,
    vocabulary: createMemoryVocabularyRegistry(),
  })
  applications.push(application)
  return { application, baseUrl: await listen(application) }
}

describe('异步文件日志生命周期与脱敏', () => {
  it('LOG_LEVEL 控制 debug/info/warn/error，关闭前排空缓冲且丢弃非白名单上下文', async () => {
    const root = temporaryDirectory()
    const logPath = join(root, 'operations.log')
    const logger = makeLogger(deployment('warn'), { logPath })
    const secret = 'sensitive-recovery-token'

    logger.debug({ event: 'debug' }, '房间阶段已转换')
    logger.info({ event: 'info' }, '玩家会话已注册')
    logger.warn(
      {
        event: 'room:create',
        recoveryToken: secret,
        answer: 'secret-answer',
        payload: { chat: 'full-chat' },
      } as never,
      '正在优雅关闭服务',
    )
    logger.error({ errorType: 'TypeError' }, '服务器启动失败')
    await logger.flush()
    await logger.close()

    const content = readFileSync(logPath, 'utf8')
    expect(content).toContain('正在优雅关闭服务')
    expect(content).toContain('服务器启动失败')
    expect(content).not.toContain('房间阶段已转换')
    expect(content).not.toContain('玩家会话已注册')
    for (const forbidden of [secret, 'secret-answer', 'full-chat', 'recoveryToken', 'payload']) {
      expect(content).not.toContain(forbidden)
    }
  })

  it('异常退出路径可用 flushSync 尽力保存最后一条错误，不依赖异步 close 回调', async () => {
    const root = temporaryDirectory()
    const logPath = join(root, 'fatal.log')
    const logger = makeLogger(deployment('debug'), { logPath })
    logger.debug({ event: EVENTS.roomCreate }, '房间阶段已转换')
    await logger.flush()
    expect(readFileSync(logPath, 'utf8')).toContain('房间阶段已转换')

    logger.error({ errorType: 'Error' }, '服务器启动失败')
    logger.flushSync()
    expect(readFileSync(logPath, 'utf8')).toContain('服务器启动失败')
    await logger.close()
  })

  it('shutdown 始终在应用资源之后 flush/close 日志，并把关闭失败转换为退出码', async () => {
    const order: string[] = []
    const logger = mockLogger(order)
    const application = {
      close: vi.fn(async () => void order.push('application-close')),
    } as unknown as Parameters<typeof shutdownApplication>[0]

    await expect(shutdownApplication(application, logger)).resolves.toBe(0)
    expect(order).toEqual(['application-close', 'flush', 'logger-close'])

    const failingLogger = mockLogger()
    const failingApplication = {
      close: vi.fn(async () => {
        throw new Error('private failure detail')
      }),
    } as unknown as Parameters<typeof shutdownApplication>[0]
    await expect(shutdownApplication(failingApplication, failingLogger)).resolves.toBe(1)
    expect(failingLogger.error).toHaveBeenCalledWith({ errorType: 'Error' }, '服务关闭失败')
    expect(failingLogger.flush).toHaveBeenCalledOnce()
    expect(failingLogger.close).toHaveBeenCalledOnce()

    const flushFailureOrder: string[] = []
    const flushFailureLogger = mockLogger(flushFailureOrder)
    vi.mocked(flushFailureLogger.flush).mockRejectedValueOnce(new Error('disk unavailable'))
    const flushFailureApplication = {
      close: vi.fn(async () => void flushFailureOrder.push('application-close')),
    } as unknown as Parameters<typeof shutdownApplication>[0]
    await expect(shutdownApplication(flushFailureApplication, flushFailureLogger)).resolves.toBe(1)
    expect(flushFailureOrder).toEqual(['application-close', 'flush-sync', 'logger-close'])
  })
})

describe('有界进程指标', () => {
  it('只聚合枚举与数值，并为调用方返回不可反向修改的快照', () => {
    const metrics = new OperationalMetrics()
    metrics.connectionOpened()
    metrics.connectionOpened()
    metrics.connectionClosed()
    metrics.recordResync(true)
    metrics.recordResync(false)
    metrics.recordAcknowledgement(EVENTS.roomCreate, 10, 'VERSION_CONFLICT')
    metrics.recordAcknowledgement(EVENTS.drawStrokeBatch, 30, 'DRAW_BUDGET_EXCEEDED')
    metrics.recordAcknowledgement('attacker:event' as never, Number.NaN, 'INTERNAL_ERROR')

    const snapshot = metrics.snapshot(3)
    expect(snapshot).toMatchObject({
      onlineConnections: 1,
      roomCount: 3,
      protocol: { invalidPushReports: 1, resyncRequests: 2 },
      drawing: { budgetRejections: 1 },
      acknowledgements: { count: 2, averageLatencyMs: 20 },
      errorsByEvent: {
        [EVENTS.roomCreate]: { VERSION_CONFLICT: 1 },
        [EVENTS.drawStrokeBatch]: { DRAW_BUDGET_EXCEEDED: 1 },
      },
    })
    snapshot.errorsByEvent[EVENTS.roomCreate]!.VERSION_CONFLICT = 99
    expect(metrics.snapshot(3).errorsByEvent[EVENTS.roomCreate]?.VERSION_CONFLICT).toBe(1)
    expect(JSON.stringify(snapshot)).not.toMatch(/token|answer|chat|payload/iu)
  })

  it('binder 自动统计各事件错误、invalid push resync 与平均 ack 延迟', async () => {
    type BinderSocket = Parameters<typeof bindRequest>[0]
    type Listener = (raw: unknown, callback?: (ack: Ack<unknown>) => void) => Promise<void>
    const listeners = new Map<string, Listener>()
    const metrics = new OperationalMetrics()
    let now = 1_000
    const socket = {
      data: {
        playerId: '00000000-0000-4000-8000-000000000001',
        requestCache: new Map(),
        inFlightRequests: new Map(),
        service: {
          clock: { now: () => now },
          metrics,
          logUnexpectedError: vi.fn(),
        },
      },
      on: (event: string, listener: Listener) => void listeners.set(event, listener),
    } as unknown as BinderSocket

    bindRequest(socket, EVENTS.stateResync, StateResyncSchema, () => {
      now += 10
      return undefined
    })
    bindRequest(
      socket,
      EVENTS.drawClear,
      CLIENT_REQUEST_SCHEMAS[EVENTS.drawClear],
      () => {
        now += 30
        throw new GameError('DRAW_BUDGET_EXCEEDED')
      },
      { rateLimit: false },
    )

    const requestId = '00000000-0000-4000-8000-000000000010'
    await listeners.get(EVENTS.stateResync)?.({ requestId, reason: 'invalid_push' }, vi.fn())
    await listeners.get(EVENTS.drawClear)?.(
      {
        requestId: '00000000-0000-4000-8000-000000000011',
        roundId: '00000000-0000-4000-8000-000000000012',
      },
      vi.fn(),
    )

    expect(metrics.snapshot(0)).toMatchObject({
      protocol: { invalidPushReports: 1, resyncRequests: 1 },
      drawing: { budgetRejections: 1 },
      acknowledgements: { count: 2, averageLatencyMs: 20 },
      errorsByEvent: { [EVENTS.drawClear]: { DRAW_BUDGET_EXCEEDED: 1 } },
    })
  })
})

describe('/api/health 最小公开边界', () => {
  it('详细指标开关默认关闭且只接受显式真值', () => {
    expect(getDeploymentConfig({}).healthMetricsEnabled).toBe(false)
    expect(getDeploymentConfig({ HEALTH_METRICS_ENABLED: 'true' }).healthMetricsEnabled).toBe(true)
    expect(getDeploymentConfig({ HEALTH_METRICS_ENABLED: 'false' }).healthMetricsEnabled).toBe(
      false,
    )
  })

  it('浏览器自动打开开关默认开启，显式关闭值（含历史 0）均不打开', () => {
    expect(getDeploymentConfig({}).openBrowserEnabled).toBe(true)
    expect(getDeploymentConfig({ DRAW_GUESS_OPEN_BROWSER: '0' }).openBrowserEnabled).toBe(false)
    expect(getDeploymentConfig({ DRAW_GUESS_OPEN_BROWSER: 'false' }).openBrowserEnabled).toBe(false)
    expect(getDeploymentConfig({ DRAW_GUESS_OPEN_BROWSER: 'true' }).openBrowserEnabled).toBe(true)
    expect(getDeploymentConfig({ DRAW_GUESS_OPEN_BROWSER: ' ' }).openBrowserEnabled).toBe(true)
  })

  it('默认响应没有详细指标，即使请求来自本机', async () => {
    const { baseUrl } = await applicationWithHealthDetails(false)
    const response = await fetch(`${baseUrl}/api/health`)
    const body = (await response.json()) as Record<string, unknown>

    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toMatchObject({ ok: true })
    expect(body).not.toHaveProperty('details')
    expect(JSON.stringify(body)).not.toMatch(/roomCount|errorsByEvent|vocabularyCount/u)
  })

  it('显式开关只为回环请求返回安全聚合指标', async () => {
    const { application, baseUrl } = await applicationWithHealthDetails(true)
    application.metrics.recordAcknowledgement(EVENTS.roomCreate, 12, 'ROOM_FULL')
    const body = (await (await fetch(`${baseUrl}/api/health`)).json()) as Record<string, unknown>

    expect(body).toHaveProperty('details.metrics.acknowledgements.averageLatencyMs', 12)
    expect(body).toHaveProperty('details.metrics.errorsByEvent.room:create.ROOM_FULL', 1)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.20')).toBe(false)
  })
})
