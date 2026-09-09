/**
 * 可失败请求的统一封装（timeout + ack + 错误翻译 + 幂等 requestId）。
 * quiet 请求（绘图高频事件）失败时不弹 Toast，避免连续错误刷屏。
 */
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import type {
  Ack,
  ClientRequestEvent,
  ClientRequestPayload,
  ClientResponse,
  ErrorCode,
} from '@draw-guess/shared'
import { createUuid } from '@/utils/createUuid'
import type { Socket } from 'socket.io-client'
import { reactive, readonly } from 'vue'

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
 */
export type RequestResult<T> =
  | { ok: true; data: T; timeout?: false }
  | {
      ok: false
      failureKind: 'business' | 'transport'
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

function cancellationFailure(): RequestFailure {
  return {
    ok: false,
    failureKind: 'transport',
    error: strings.request.cancelled,
    timeout: false,
    cancelled: true,
  }
}

function classifyTransportError(error: unknown): { message: string; timeout: boolean } {
  const message = error instanceof Error ? error.message : strings.request.genericFailure
  return {
    message,
    timeout: message.includes('operation has timed out'),
  }
}

/** 创建带统一错误翻译的请求函数：不抛错，返回可判别结果对象。 */
export function createRequester(options: { socket: Socket; notify: NotifyFn }): ManagedRequester {
  const { socket, notify } = options
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
          const ack = (await raceCancellation(
            socket
              .timeout(APP_CONFIG.network.requestTimeoutMs)
              .emitWithAck(event, { ...payload, requestId }),
            controller.signal,
          )) as Ack<ClientResponse<E>>
          if (!ack.ok) {
            // 业务失败没有产生副作用且服务端不缓存；调用方应修正状态后发起新的逻辑请求。
            if (!requestOptions.quiet) notify(ack.error.message, 'error')
            return {
              ok: false,
              failureKind: 'business',
              error: ack.error.message,
              code: ack.error.code,
              timeout: false,
            }
          }
          return { ok: true, data: ack.data }
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
      const errorMessage = transport.timeout ? strings.request.timeoutMessage : transport.message
      // 所有自动尝试均失败后只提示一次，避免瞬时重连产生重复 Toast。
      if (!requestOptions.quiet) notify(errorMessage, 'error')
      return {
        ok: false,
        failureKind: 'transport',
        error: errorMessage,
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
