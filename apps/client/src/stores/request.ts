/**
 * 可失败请求的统一封装（timeout + ack 运行时校验 + 错误翻译 + 幂等 requestId）。
 * quiet 请求（绘图高频事件）失败时不弹 Toast，避免连续错误刷屏。
 */
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import type {
  ClientRequestEvent,
  ClientRequestPayload,
  ClientResponse,
  ErrorCode,
} from '@draw-guess/shared'
import { createUuid } from '@/utils/create-uuid'
import type { GameSocket } from './socket.ts'
import { reactive, readonly } from 'vue'
import { decodeClientResponse } from './response-protocol.ts'

/** 请求选项：quiet 表示失败时静默降级（不弹错误 Toast）。 */
export interface RequestOptions {
  quiet?: boolean
  /** 网络超时后的重试必须复用同一 ID，保证服务端幂等缓存仍能返回原始 ack。 */
  requestId?: string
  /** 是否启用传输故障自动重试；默认仅普通请求启用，高频 quiet 请求不重试。 */
  retry?: boolean
}

export interface RequestState {
  pendingCount: number
  destroyed: boolean
}

/** 通知回调用类型（与 store.notify 对齐）。 */
export type NotifyFn = (text: string, type?: 'success' | 'warning' | 'error') => void

/**
 * 可失败请求的可判别结果：调用方用 `result.ok` 明确区分成功与失败，
 * 不再依赖“失败抛错”的隐式约定。timeout 用于标记请求是否因超时失败。
 * `protocol` 表示 ack 未通过运行时 Schema（响应损坏/协议不匹配），既不是业务拒绝也不会重试。
 */
export type RequestResult<T> =
  | { ok: true; data: T; timeout?: false }
  | {
      ok: false
      failureKind: 'business' | 'transport' | 'protocol'
      error: string
      code?: ErrorCode
      timeout: boolean
      cancelled?: boolean
    }

export type RequestFailure = Extract<RequestResult<never>, { ok: false }>

type RequestInput<E extends ClientRequestEvent> = Omit<ClientRequestPayload<E>, 'requestId'>
type RequestArguments<E extends ClientRequestEvent> = keyof RequestInput<E> extends never
  ? [payload?: RequestInput<E>, requestOptions?: RequestOptions]
  : [payload: RequestInput<E>, requestOptions?: RequestOptions]

export interface Requester {
  <E extends ClientRequestEvent>(
    event: E,
    ...args: RequestArguments<E>
  ): Promise<RequestResult<ClientResponse<E>>>
}

export interface ManagedRequester extends Requester {
  state: Readonly<RequestState>
  cancelAll(): void
  destroy(): void
}

class RequestCancelledError extends Error {}
class RequestTimeoutError extends Error {}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function raceCancellation<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new RequestCancelledError())
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', cancel)
    const cancel = () => {
      cleanup()
      reject(new RequestCancelledError())
    }
    signal.addEventListener('abort', cancel, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

/**
 * 请求超时哨兵：不依赖 socket.io 的 `timeout()` 与英文错误消息判型（那条字符串一旦变化，
 * 超时就会被误判成普通传输错误并向用户显示原始英文）。完成/失败/取消/超时四个出口都会清理
 * 定时器与 abort 监听，避免在途定时器悬挂到热更新或测试结束之后。
 */
function raceTimeout<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new RequestCancelledError())
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const settle = (action: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      action()
    }
    const onAbort = () => settle(() => reject(new RequestCancelledError()))
    const timer = setTimeout(() => settle(() => reject(new RequestTimeoutError())), timeoutMs)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    )
  })
}

function cancellationFailure(): RequestFailure {
  return {
    ok: false,
    failureKind: 'transport',
    error: strings.request.cancelled,
    timeout: false,
    cancelled: true,
  }
}

/** 传输失败统一映射为中文安全文案；只有本模块的超时哨兵能产生 timeout 语义。 */
function classifyTransportError(error: unknown): { message: string; timeout: boolean } {
  if (error instanceof RequestTimeoutError)
    return { message: strings.request.timeoutMessage, timeout: true }
  return { message: strings.request.genericFailure, timeout: false }
}

/** 创建带统一错误翻译的请求函数：不抛错，返回可判别结果对象。 */
export function createRequester(options: {
  socket: GameSocket
  notify: NotifyFn
}): ManagedRequester {
  const { socket, notify } = options
  // emitWithAck 的返回值刻意收窄为 unknown：客户端从不信任线路上的 ack，必须过
  // decodeClientResponse 运行时 Schema（防协议版本漂移）；泛型事件名下 Socket.IO 的
  // Parameters<> 是延迟索引类型，函数体内无法证明 {...payload, requestId} 与
  // ClientRequestPayload<E> 匹配，故在这一唯一发送边界适配（事件↔payload 配对已由
  // Requester 对外签名保证）。
  const emitWithAck = socket.emitWithAck.bind(socket) as <E extends ClientRequestEvent>(
    event: E,
    payload: ClientRequestPayload<E>,
  ) => Promise<unknown>
  const mutableState = reactive<RequestState>({ pendingCount: 0, destroyed: false })
  const controllers = new Set<AbortController>()
  async function request<E extends ClientRequestEvent>(
    event: E,
    ...args: RequestArguments<E>
  ): Promise<RequestResult<ClientResponse<E>>> {
    if (mutableState.destroyed) return cancellationFailure()
    const controller = new AbortController()
    controllers.add(controller)
    mutableState.pendingCount += 1
    const payload = (args[0] ?? {}) as RequestInput<E>
    const requestOptions = args[1] ?? {}
    const requestId = requestOptions.requestId ?? createUuid()
    const retryEnabled = requestOptions.retry ?? !requestOptions.quiet
    const maxAttempts = 1 + (retryEnabled ? APP_CONFIG.network.requestRetryAttempts : 0)
    let lastTransportError: { message: string; timeout: boolean } | undefined

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const rawAck = await raceTimeout(
            // {...payload, requestId} 结构上等于 ClientRequestPayload<E>，但泛型 E 下
            // Omit<ClientRequestPayload<E>,'requestId'> & {requestId} 无法被编译器折叠回原形，
            // 在边界处收窄一次（payload 内容已由 Requester 对外签名与运行时 Schema 双重保证）。
            emitWithAck(event, { ...payload, requestId } as ClientRequestPayload<E>),
            APP_CONFIG.network.requestTimeoutMs,
            controller.signal,
          )
          // 响应必须先通过事件级 ack Schema 且回显同一 requestId：解析失败属于协议损坏，
          // 既不重试也不回显任何原始内容，调用方得到 ok:false，绝不会把脏数据写进 Pinia。
          const decoded = decodeClientResponse(event, rawAck, requestId)
          if (decoded.status === 'invalid') {
            if (!requestOptions.quiet) notify(strings.request.protocolFailure, 'error')
            return {
              ok: false,
              failureKind: 'protocol',
              error: strings.request.protocolFailure,
              timeout: false,
            }
          }
          if (!decoded.ack.ok) {
            // 业务失败没有产生副作用且服务端不缓存；调用方应修正状态后发起新的逻辑请求。
            if (!requestOptions.quiet) notify(decoded.ack.error.message, 'error')
            return {
              ok: false,
              failureKind: 'business',
              error: decoded.ack.error.message,
              code: decoded.ack.error.code,
              timeout: false,
            }
          }
          return { ok: true, data: decoded.ack.data }
        } catch (error) {
          if (error instanceof RequestCancelledError) return cancellationFailure()
          lastTransportError = classifyTransportError(error)
          if (attempt + 1 < maxAttempts)
            await raceCancellation(delay(APP_CONFIG.network.requestRetryDelayMs), controller.signal)
        }
      }

      const transport = lastTransportError ?? {
        message: strings.request.genericFailure,
        timeout: false,
      }
      // 所有自动尝试均失败后只提示一次，避免瞬时重连产生重复 Toast。
      if (!requestOptions.quiet) notify(transport.message, 'error')
      return {
        ok: false,
        failureKind: 'transport',
        error: transport.message,
        timeout: transport.timeout,
      }
    } catch (error) {
      if (error instanceof RequestCancelledError) return cancellationFailure()
      throw error
    } finally {
      controllers.delete(controller)
      mutableState.pendingCount -= 1
    }
  }
  const managed = request as ManagedRequester
  managed.state = readonly(mutableState)
  managed.cancelAll = () => {
    for (const controller of controllers) controller.abort()
  }
  managed.destroy = () => {
    if (mutableState.destroyed) return
    mutableState.destroyed = true
    managed.cancelAll()
  }
  return managed
}
