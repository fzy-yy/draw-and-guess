/**
 * Socket.IO 事件绑定层：schema 校验、会话级限频、幂等缓存与统一 ack 的通用包装。
 * 领域服务只负责执行，是否允许、是否重复由这一层统一处理。
 */
import { z, type ZodType } from 'zod'
import { APP_CONFIG } from '../../../../config/index.ts'
import { serverStrings } from '../../../../string/index.ts'
import type { Ack } from '@draw-guess/shared'
import { failure, GameError, success } from '../errors.ts'

export type { Ack }

/** 把校验错误归一化为稳定业务错误，其余异常交给统一失败响应隐藏内部细节。 */
function normalizeRequestError(error: unknown): unknown {
  return error instanceof z.ZodError
    ? new GameError('INVALID_PAYLOAD', serverStrings.errors.INVALID_PAYLOAD)
    : error
}

/** 仅记录未预期异常的脱敏上下文；业务错误不污染错误日志。 */
function logUnexpected(
  socket: import('socket.io').Socket,
  event: string,
  original: unknown,
  normalized: unknown,
): void {
  if (normalized instanceof GameError || original instanceof z.ZodError) return
  ;(
    socket.data.service as
      { logUnexpectedError: (error: unknown, context: Record<string, unknown>) => void } | undefined
  )?.logUnexpectedError(original, { event })
}

/**
 * 统一请求包装器：所有失败都以结构化 ack 返回，避免未捕获异常断开 Socket。
 * 幂等键由“事件名 + requestId”组成，并缓存完整 ack；并发重试共享同一个执行 Promise。
 */
export function bindRequest<T extends { requestId: string }, R>(
  socket: import('socket.io').Socket,
  event: string,
  schema: ZodType<T>,
  handler: (input: T, playerId: string) => R | Promise<R>,
  options: { registration?: boolean; rateLimit?: boolean } = {},
): void {
  socket.on(event, async (raw: unknown, callback?: (ack: Ack<R>) => void) => {
    const provisionalId =
      typeof raw === 'object' && raw && 'requestId' in raw
        ? String((raw as { requestId: unknown }).requestId)
        : 'invalid-request'
    const respond = typeof callback === 'function' ? callback : () => undefined

    // 每连接一秒滑动窗口限频；绘图和网络探测已有独立策略，可由调用方关闭。
    if (options.rateLimit !== false) {
      const now = Date.now()
      const history = ((socket.data.eventTimes as number[] | undefined) ?? []).filter(
        (time) => now - time < APP_CONFIG.network.requestRateWindowMs,
      )
      if (history.length >= APP_CONFIG.network.requestEventsPerSecond) {
        socket.data.eventTimes = history
        respond(
          failure(
            new GameError('RATE_LIMITED', serverStrings.errors.RATE_LIMITED),
            provisionalId,
          ) as Ack<R>,
        )
        return
      }
      history.push(now)
      socket.data.eventTimes = history
    }

    let input: T
    try {
      input = schema.parse(raw)
      const playerId = socket.data.playerId as string | undefined
      if (!options.registration && !playerId)
        throw new GameError('UNAUTHORIZED', serverStrings.errors.UNAUTHORIZED_REGISTER)

      const cacheKey = `${event}:${input.requestId}`
      const cache = socket.data.requestCache as Map<string, Ack<unknown>> | undefined
      const cached = cache?.get(cacheKey)
      if (cached) {
        respond(cached as Ack<R>)
        return
      }

      const inFlight = socket.data.inFlightRequests as
        Map<string, Promise<Ack<unknown>>> | undefined
      const existing = inFlight?.get(cacheKey)
      if (existing) {
        respond((await existing) as Ack<R>)
        return
      }

      // Promise 在调用 handler 前先写入表，确保同一时刻的重复副作用只执行一次。
      const execution = (async (): Promise<Ack<R>> => {
        try {
          return success(await handler(input, playerId ?? ''), input.requestId)
        } catch (error) {
          const normalized = normalizeRequestError(error)
          logUnexpected(socket, event, error, normalized)
          return failure(normalized, input.requestId) as Ack<R>
        }
      })()
      inFlight?.set(cacheKey, execution as Promise<Ack<unknown>>)
      const ack = await execution
      inFlight?.delete(cacheKey)

      // 注册 handler 会把 socket 缓存切换到玩家级缓存；因此执行后重新读取当前引用。
      const liveCache = socket.data.requestCache as Map<string, Ack<unknown>> | undefined
      // 只缓存成功结果：失败的请求没有产生副作用，若也缓存，客户端用同一 requestId 重试
      // 会永远取回旧的 RATE_LIMITED / VERSION_CONFLICT 等瞬时错误而无法自愈。
      if (liveCache && ack.ok) {
        liveCache.set(cacheKey, ack as Ack<unknown>)
        // 简单 FIFO 上限，防止长时间连接下幂等缓存无界增长
        if (liveCache.size > APP_CONFIG.network.idempotencyCacheMax)
          liveCache.delete(liveCache.keys().next().value as string)
      }
      respond(ack)
    } catch (error) {
      const normalized = normalizeRequestError(error)
      logUnexpected(socket, event, error, normalized)
      respond(failure(normalized, provisionalId) as Ack<R>)
    }
  })
}
