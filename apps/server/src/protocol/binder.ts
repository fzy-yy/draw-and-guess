/**
 * Socket.IO 事件绑定层：schema 校验、会话级限频、幂等缓存与统一 ack 的通用包装。
 * 领域服务只负责执行，是否允许、是否重复由这一层统一处理。
 */
import { z, type ZodType } from 'zod'
import { APP_CONFIG } from '../config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import type {
  Ack,
  ClientRequestEvent,
  ClientRequestPayload,
  ClientResponse,
} from '@draw-guess/shared'
import { CLIENT_REQUEST_SCHEMAS, EVENTS } from '@draw-guess/shared'
import { failure, GameError, success } from '../errors.ts'
import { slidingWindowAllow } from '../rate-limit.ts'
import type { AppSocket } from '../socket-types.ts'

/** 把校验错误归一化为稳定业务错误，其余异常交给统一失败响应隐藏内部细节。 */
function normalizeRequestError(error: unknown): unknown {
  return error instanceof z.ZodError ? new GameError('INVALID_PAYLOAD') : error
}

/** 仅记录未预期异常的脱敏上下文；业务错误不污染错误日志。 */
function logUnexpected(
  socket: AppSocket,
  event: ClientRequestEvent,
  original: unknown,
  normalized: unknown,
): void {
  if (normalized instanceof GameError || original instanceof z.ZodError) return
  socket.data.service.logUnexpectedError(original, { event })
}

/**
 * 事件名 → 事件级 Schema。注册表结构保证「事件 ↔ Schema」配对，
 * 但 TS 对泛型索引的延迟类型无法证明联合成员的输入/输出收窄，
 * 因此在这里收口唯一一次 unknown 中转断言（与下方 on() 绑定同一适配手法）。
 */
function schemaOf<E extends ClientRequestEvent>(event: E): ZodType<ClientRequestPayload<E>> {
  return CLIENT_REQUEST_SCHEMAS[event] as unknown as ZodType<ClientRequestPayload<E>>
}

/**
 * 统一请求包装器：所有失败都以结构化 ack 返回，避免未捕获异常断开 Socket。
 * 幂等键由“事件名 + requestId”组成，并缓存完整 ack；并发重试共享同一个执行 Promise。
 */
export function bindRequest<E extends ClientRequestEvent>(
  socket: AppSocket,
  event: E,
  handler: (
    input: ClientRequestPayload<E>,
    playerId: string,
  ) => ClientResponse<E> | Promise<ClientResponse<E>>,
  options: { registration?: boolean; rateLimit?: boolean } = {},
  /** 仅供测试覆盖：生产调用一律省略，schema 由事件名从注册表推导。 */
  schema: ZodType<ClientRequestPayload<E>> = schemaOf(event),
): void {
  // binder 的 Schema-first 设计刻意以 unknown 接收原始 payload、再交 schema.parse 校验；
  // Socket.IO 的 EventParams 对泛型事件名是延迟条件类型，TS 无法证明监听器签名匹配，
  // 因此在这一唯一注册边界做一次「事件名仍受 ClientRequestEvent 约束」的适配
  // （不再是任意 string 事件名，事件↔ack 配对仍由泛型保证）。
  const on = socket.on.bind(socket) as <Ev extends ClientRequestEvent>(
    eventName: Ev,
    listener: (raw: unknown, callback?: (ack: Ack<ClientResponse<Ev>>) => void) => void,
  ) => void
  on(event, async (raw: unknown, callback?: (ack: Ack<ClientResponse<E>>) => void) => {
    // service 在注册任何 handler 前即挂上（app.ts），类型必选；观测记录不再需要可选链。
    const service = socket.data.service
    const startedAt = service.clock.now()
    const provisionalId =
      typeof raw === 'object' && raw && 'requestId' in raw
        ? String(raw.requestId)
        : 'invalid-request'
    let responded = false
    // 一次请求恰好一个 ack：短路同时承担「指标只记一次」与「回调异常不触发二次 respond」。
    const respond = (ack: Ack<ClientResponse<E>>): void => {
      if (responded) return
      responded = true
      service.metrics.recordAcknowledgement(
        event,
        service.clock.now() - startedAt,
        ack.ok ? undefined : ack.error.code,
      )
      if (typeof callback === 'function') callback(ack)
    }

    // 每连接一秒滑动窗口限频；绘图和网络探测已有独立策略，可由调用方关闭。
    let input: ClientRequestPayload<E>
    try {
      input = schema.parse(raw)
      if (event === EVENTS.stateResync) {
        service.metrics.recordResync(
          (input as ClientRequestPayload<typeof EVENTS.stateResync>).reason === 'invalid_push',
        )
      }
      const playerId = socket.data.playerId
      if (!options.registration && !playerId)
        throw new GameError('UNAUTHORIZED', serverStrings.errors.UNAUTHORIZED_REGISTER)

      const cacheKey = `${event}:${input.requestId}`
      const cached = socket.data.requestCache.get(cacheKey)
      if (cached) {
        // 缓存只写入「已通过 ack Schema 校验」的成功结果，取回时按当前事件收窄一次类型。
        respond(cached as Ack<ClientResponse<E>>)
        return
      }

      const existing = socket.data.inFlightRequests.get(cacheKey)
      if (existing) {
        respond((await existing) as Ack<ClientResponse<E>>)
        return
      }

      if (options.rateLimit !== false) {
        const decision = slidingWindowAllow(
          socket.data.eventTimes ?? [],
          service.clock.now(),
          APP_CONFIG.network.requestRateWindowMs,
          APP_CONFIG.network.requestEventsPerSecond,
        )
        // 无论放行与否都回写过滤后的队列：窗口必须随时间前滚，拒绝记录同样受益。
        socket.data.eventTimes = decision.times
        if (!decision.allowed) {
          respond(failure(new GameError('RATE_LIMITED'), input.requestId))
          return
        }
      }

      // Promise 在调用 handler 前先写入表，确保同一时刻的重复副作用只执行一次。
      const execution = (async (): Promise<Ack<ClientResponse<E>>> => {
        try {
          return success(await handler(input, playerId ?? ''), input.requestId)
        } catch (error) {
          const normalized = normalizeRequestError(error)
          logUnexpected(socket, event, error, normalized)
          return failure(normalized, input.requestId)
        }
      })()
      socket.data.inFlightRequests.set(cacheKey, execution)
      const ack = await execution
      socket.data.inFlightRequests.delete(cacheKey)

      // 注册 handler 会把 socket 缓存切换到玩家级缓存；因此执行后重新读取当前引用。
      const liveCache = socket.data.requestCache
      // 只缓存成功结果：失败的请求没有产生副作用，若也缓存，客户端用同一 requestId 重试
      // 会永远取回旧的 RATE_LIMITED / VERSION_CONFLICT 等瞬时错误而无法自愈。
      if (ack.ok) {
        liveCache.set(cacheKey, ack)
        // 简单 FIFO 上限，防止长时间连接下幂等缓存无界增长
        if (liveCache.size > APP_CONFIG.network.idempotencyCacheMax) {
          const oldest = liveCache.keys().next().value
          if (oldest !== undefined) liveCache.delete(oldest)
        }
      }
      respond(ack)
    } catch (error) {
      const normalized = normalizeRequestError(error)
      logUnexpected(socket, event, error, normalized)
      respond(failure(normalized, provisionalId))
    }
  })
}
