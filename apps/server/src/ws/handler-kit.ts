/**
 * Socket.IO 统一请求绑定与处理器包装器（HandlerKit）。
 *
 * 遵循《后端架构规范》R4.6b、R4.6c 与 R4.6d：
 * 1. 统一包装器拦截所有请求，严禁任何未捕获异常冒泡逃逸崩溃进程；
 * 2. 运行时强制 Zod Schema 校验，校验失败自动返回 422 VALIDATION_FAILED；
 * 3. 统一信封：全部请求经 ack 返回规范 { ok: true, data } 或 { ok: false, error: { code, message } }；
 * 4. 内置会话级滑动窗口限频、并发同 requestId 请求合并（Promise 共享）与幂等成功 ACK 缓存。
 */
import { z, type ZodType } from 'zod'
import { APP_CONFIG } from '../core/config.ts'
import { serverStrings } from '@draw-guess/strings'
import type {
  Ack,
  ClientRequestEvent,
  ClientRequestPayload,
  ClientResponse,
} from '@draw-guess/shared'
import { CLIENT_REQUEST_SCHEMAS, EVENTS } from '@draw-guess/shared'
import {
  AppError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
  failure,
  success,
} from '../core/errors.ts'
import { slidingWindowAllow } from '../rate-limit.ts'
import type { AppSocket } from './contracts.ts'

/**
 * 将输入异常归一化为标准的 AppError 实例。
 */
function normalizeRequestError(error: unknown): unknown {
  if (error instanceof z.ZodError) {
    return new ValidationError(serverStrings.errors.INVALID_PAYLOAD, z.flattenError(error), error)
  }
  return error
}

/**
 * 仅记录非业务异常的脱敏结构化日志。
 */
function logUnexpected(
  socket: AppSocket,
  event: ClientRequestEvent,
  original: unknown,
  normalized: unknown,
): void {
  if (normalized instanceof AppError && normalized.status < 500) {
    return
  }
  socket.data.service.logUnexpectedError(original, {
    socketId: socket.id,
    playerId: socket.data.playerId,
    event,
  })
}

/**
 * 获取请求事件对应的 Zod 验证契约。
 */
function schemaOf<E extends ClientRequestEvent>(event: E): ZodType<ClientRequestPayload<E>> {
  return CLIENT_REQUEST_SCHEMAS[event] as unknown as ZodType<ClientRequestPayload<E>>
}

/**
 * 统一请求绑定函数。
 *
 * @param socket 客户端 Socket 连接实例
 * @param event 客户端请求事件名
 * @param handler 领域服务执行函数
 * @param options 绑定配置（是否允许未注册调用、是否开启连接限频）
 * @param schema 显式校验 Schema（生产环境由事件名自动推导）
 */
export function bindRequest<E extends ClientRequestEvent>(
  socket: AppSocket,
  event: E,
  handler: (
    input: ClientRequestPayload<E>,
    playerId: string,
  ) => ClientResponse<E> | Promise<ClientResponse<E>>,
  options: { registration?: boolean; rateLimit?: boolean } = {},
  schema: ZodType<ClientRequestPayload<E>> = schemaOf(event),
): void {
  const on = socket.on.bind(socket) as <Ev extends ClientRequestEvent>(
    eventName: Ev,
    listener: (raw: unknown, callback?: (ack: Ack<ClientResponse<Ev>>) => void) => void,
  ) => void

  on(event, async (raw: unknown, callback?: (ack: Ack<ClientResponse<E>>) => void) => {
    const service = socket.data.service
    const startedAt = service.clock.now()
    const provisionalId =
      typeof raw === 'object' && raw && 'requestId' in raw
        ? String(raw.requestId)
        : 'invalid-request'
    let responded = false

    const respond = (ack: Ack<ClientResponse<E>>): void => {
      if (responded) return
      responded = true
      service.metrics.recordAcknowledgement(
        event,
        service.clock.now() - startedAt,
        ack.ok ? undefined : ack.error.code,
      )
      if (typeof callback === 'function') {
        callback(ack)
      }
    }

    let input: ClientRequestPayload<E>
    try {
      input = schema.parse(raw)
      if (event === EVENTS.stateResync) {
        service.metrics.recordResync(
          (input as ClientRequestPayload<typeof EVENTS.stateResync>).reason === 'invalid_push',
        )
      }

      const playerId = socket.data.playerId
      if (!options.registration && !playerId) {
        throw new UnauthorizedError(serverStrings.errors.UNAUTHORIZED_REGISTER)
      }

      const cacheKey = `${event}:${input.requestId}`
      const cached = socket.data.requestCache.get(cacheKey)
      if (cached) {
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
        socket.data.eventTimes = decision.times
        if (!decision.allowed) {
          respond(failure(new RateLimitError(), input.requestId))
          return
        }
      }

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

      const liveCache = socket.data.requestCache
      if (ack.ok) {
        liveCache.set(cacheKey, ack)
        if (liveCache.size > APP_CONFIG.network.idempotencyCacheMax) {
          const oldest = liveCache.keys().next().value
          if (oldest !== undefined) {
            liveCache.delete(oldest)
          }
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
