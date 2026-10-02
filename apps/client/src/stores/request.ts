/**
 * 可失败请求的统一封装（timeout + ack 运行时校验 + 错误翻译 + 幂等 requestId）。
 * 传输重试（retry）与失败 Toast（notify）是两个正交开关——旧 quiet 的一符双义已拆分
 * （ADR-0022）：静默请求不再自动关闭重试，调用方按语义各自显式声明。
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
import { reactive, readonly } from 'vue'
import { decodeClientResponse } from './response-protocol.ts'

/** 请求选项：传输重试与失败 Toast 归属为两个独立开关（语义拆分见 ADR-0022）。 */
export interface RequestOptions {
  /**
   * 传输故障（超时/断线）时以同一 requestId 自动重试；默认启用。
   * 高频绘图命令与画布控制（撤销/重做/清空）显式关闭——它们的收敛靠权威快照与
   * 增量推送，不靠盲目重发；静默（notify:'silent'）不再隐式关闭重试。
   */
  retry?: boolean
  /**
   * 失败 Toast 归属：'always'（默认）对协议/业务/传输三类失败统一弹服务端安全文案；
   * 'silent' 一条都不弹（避免连续错误刷屏），调用方按 ok:false 结果自行恢复，
   * 需要提示的错误码由调用方选择性补弹（见 gameplay 的容量类拒绝）。
   */
  notify?: 'always' | 'silent'
  /**
   * 显式指定幂等 ID——测试观测接缝：生产调用方一律不传，由请求层内部生成并在传输重试时
   * 复用同一 ID（服务端幂等缓存据此回原始 ack）；测试用它钉死重发载荷的 ID 断言。
   */
  requestId?: string
}

export interface RequestState {
  pendingCount: number
  destroyed: boolean
}

/** 通知回调用类型（与 store.notify 对齐）。 */
export type NotifyFn = (text: string, type?: 'success' | 'warning' | 'error') => void

/**
 * 可失败请求的可判别结果：调用方用 `result.ok` 明确区分成功与失败，
 * 不再依赖“失败抛错”的隐式约定。生产行为分支一律以 ok 与 failureKind 判定；
 * `timeout` / `cancelled` 只是诊断/测试观测接缝——标记失败细分成因（超时哨兵命中 /
 * 主动取消）供日志与测试断言，调用方不得据此做行为分叉。
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
    error: strings.ui.request.cancelled,
    timeout: false,
    cancelled: true,
  }
}

/** 传输失败统一映射为中文安全文案；只有本模块的超时哨兵能产生 timeout 语义。 */
function classifyTransportError(error: unknown): { message: string; timeout: boolean } {
  if (error instanceof RequestTimeoutError)
    return { message: strings.ui.request.timeoutMessage, timeout: true }
  return { message: strings.ui.request.genericFailure, timeout: false }
}

/** 创建带统一错误翻译的请求函数：不抛错，返回可判别结果对象。 */
/**
 * 请求层所需的最小发送端口（socket.io 的 Socket 结构上满足；测试直接实现字面对象）。
 *
 * 刻意不含整个 Socket 面：调用方与替身只需知道「泛型事件名 → 载荷 → unknown ack」，
 * 假实现无需 `as never` 伪装；ack 返回值收窄为 unknown 是安全姿态——线路响应必须过
 * decodeClientResponse 运行时 Schema（防协议版本漂移），类型接入不等于信任。
 */
export interface RequestAckTransport {
  emitWithAck<E extends ClientRequestEvent>(
    event: E,
    payload: ClientRequestPayload<E>,
  ): Promise<unknown>
}

export function createRequester(options: {
  socket: RequestAckTransport
  notify: NotifyFn
}): ManagedRequester {
  const { socket, notify } = options
  // 端口签名与转发箭头完全同形，无需断言；真实 Socket 的适配只发生在 game-transport 的
  // io() 构造边界（Socket.IO 的 EventParams<> 对泛型事件名是延迟索引类型，不可直接证明）。
  const emitWithAck = <E extends ClientRequestEvent>(
    event: E,
    payload: ClientRequestPayload<E>,
  ): Promise<unknown> => socket.emitWithAck(event, payload)
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
    // 重试开关独立于 Toast 归属（ADR-0022）：静默请求默认仍可重试，关不关由调用方显式声明。
    const retryEnabled = requestOptions.retry ?? true
    const maxAttempts = 1 + (retryEnabled ? APP_CONFIG.network.requestRetryAttempts : 0)

    try {
      // 循环不变式：try 分支要么 return 要么 continue 到下一轮；catch 分支在最后一次尝试就地返回。
      // 因此不存在「循环正常退出」的路径，终态传输失败无需再兜底默认值。
      let attempt = 0
      for (;;) {
        attempt += 1
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
            if (requestOptions.notify !== 'silent')
              notify(strings.ui.request.protocolFailure, 'error')
            return {
              ok: false,
              failureKind: 'protocol',
              error: strings.ui.request.protocolFailure,
              timeout: false,
            }
          }
          if (!decoded.ack.ok) {
            // 业务失败没有产生副作用且服务端不缓存；调用方应修正状态后发起新的逻辑请求。
            if (requestOptions.notify !== 'silent') notify(decoded.ack.error.message, 'error')
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
          const transport = classifyTransportError(error)
          if (attempt < maxAttempts) {
            await raceCancellation(delay(APP_CONFIG.network.requestRetryDelayMs), controller.signal)
            continue
          }
          // 所有自动尝试均失败后只提示一次，避免瞬时重连产生重复 Toast。
          if (requestOptions.notify !== 'silent') notify(transport.message, 'error')
          return {
            ok: false,
            failureKind: 'transport',
            error: transport.message,
            timeout: transport.timeout,
          }
        }
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
