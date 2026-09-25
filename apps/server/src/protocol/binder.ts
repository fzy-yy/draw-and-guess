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
import { EVENTS } from '@draw-guess/shared'
import { failure, GameError, success } from '../errors.ts'
import type { AppSocket } from '../socket-types.ts'

export type { Ack }

/** 把校验错误归一化为稳定业务错误，其余异常交给统一失败响应隐藏内部细节。 */
function normalizeRequestError(error: unknown): unknown {
  return error instanceof z.ZodError
    ? new GameError('INVALID_PAYLOAD', serverStrings.errors.INVALID_PAYLOAD)
    : error
}

/** 仅记录未预期异常的脱敏上下文；业务错误不污染错误日志。 */
function logUnexpected(
  socket: AppSocket,
  event: ClientRequestEvent,
  original: unknown,
  normalized: unknown,
): void {
  if (normalized instanceof GameError || original instanceof z.ZodError) return
  socket.data.service?.logUnexpectedError(original, { event })
}

/**
 * 统一请求包装器：所有失败都以结构化 ack 返回，避免未捕获异常断开 Socket。
 * 幂等键由“事件名 + requestId”组成，并缓存完整 ack；并发重试共享同一个执行 Promise。
 */
export function bindRequest<E extends ClientRequestEvent>(
  socket: AppSocket,
  event: E,
  schema: ZodType<ClientRequestPayload<E>>,
  handler: (
    input: ClientRequestPayload<E>,
    playerId: string,
  ) => ClientResponse<E> | Promise<ClientResponse<E>>,
  options: { registration?: boolean; rateLimit?: boolean } = {},
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
    const service = socket.data.service
    const startedAt = service?.clock.now()
    const provisionalId =
      typeof raw === 'object' && raw && 'requestId' in raw
        ? String(raw.requestId)
        : 'invalid-request'
    let metricsRecorded = false
    const respond = (ack: Ack<ClientResponse<E>>): void => {
      if (!metricsRecorded) {
        metricsRecorded = true
        const finishedAt = service?.clock.now()
        // 指标记录是尽力而为的观测：service/metrics 任一缺失都不应让请求处理崩溃，故用可选链。
        service?.metrics?.recordAcknowledgement(
          event,
          startedAt === undefined || finishedAt === undefined ? 0 : finishedAt - startedAt,
          ack.ok ? undefined : ack.error.code,
        )
      }
      if (typeof callback === 'function') callback(ack)
    }

    // 每连接一秒滑动窗口限频；绘图和网络探测已有独立策略，可由调用方关闭。
    let input: ClientRequestPayload<E>
    try {
      input = schema.parse(raw)
      if (event === EVENTS.stateResync) {
        service?.metrics?.recordResync(
          (input as ClientRequestPayload<typeof EVENTS.stateResync>).reason === 'invalid_push',
        )
      }
      const playerId = socket.data.playerId
      if (!options.registration && !playerId)
        throw new GameError('UNAUTHORIZED', serverStrings.errors.UNAUTHORIZED_REGISTER)

      const cacheKey = `${event}:${input.requestId}`
      const cache = socket.data.requestCache
      const cached = cache?.get(cacheKey)
      if (cached) {
        // 缓存只写入「已通过 ack Schema 校验」的成功结果，取回时按当前事件收窄一次类型。
        respond(cached as Ack<ClientResponse<E>>)
        return
      }

      const inFlight = socket.data.inFlightRequests
      const existing = inFlight?.get(cacheKey)
      if (existing) {
        respond((await existing) as Ack<ClientResponse<E>>)
        return
      }

      if (options.rateLimit !== false) {
        const clock = service?.clock
        if (!clock) throw new Error('binder runtime clock is not initialized')
        const now = clock.now()
        const history = (socket.data.eventTimes ?? []).filter(
          (time) => now - time < APP_CONFIG.network.requestRateWindowMs,
        )
        if (history.length >= APP_CONFIG.network.requestEventsPerSecond) {
          socket.data.eventTimes = history
          respond(
            failure(
              new GameError('RATE_LIMITED', serverStrings.errors.RATE_LIMITED),
              input.requestId,
            ),
          )
          return
        }
        history.push(now)
        socket.data.eventTimes = history
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
      inFlight?.set(cacheKey, execution)
      const ack = await execution
      inFlight?.delete(cacheKey)

      // 注册 handler 会把 socket 缓存切换到玩家级缓存；因此执行后重新读取当前引用。
      const liveCache = socket.data.requestCache
      // 只缓存成功结果：失败的请求没有产生副作用，若也缓存，客户端用同一 requestId 重试
      // 会永远取回旧的 RATE_LIMITED / VERSION_CONFLICT 等瞬时错误而无法自愈。
      if (liveCache && ack.ok) {
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
