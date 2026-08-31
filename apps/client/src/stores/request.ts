/**
 * 可失败请求的统一封装（timeout + ack + 错误翻译 + 幂等 requestId）。
 * quiet 请求（绘图高频事件）失败时不弹 Toast，避免连续错误刷屏。
 */
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import type { Ack } from '@draw-guess/shared'
import { createUuid } from '@/utils/createUuid'
import type { Socket } from 'socket.io-client'

/** 请求选项：quiet 表示失败时静默降级（不弹错误 Toast）。 */
export interface RequestOptions {
  quiet?: boolean
}

/** 通知回调用类型（与 store.notify 对齐）。 */
export type NotifyFn = (text: string, type?: 'success' | 'warning' | 'error') => void

/** 创建带统一错误翻译的请求函数。 */
export function createRequester(options: {
  socket: Socket
  notify: NotifyFn
}): <T>(
  event: string,
  payload?: Record<string, unknown>,
  requestOptions?: RequestOptions,
) => Promise<T> {
  const { socket, notify } = options
  return async function request<T>(
    event: string,
    payload: Record<string, unknown> = {},
    requestOptions: RequestOptions = {},
  ): Promise<T> {
    const requestId = createUuid()
    try {
      const ack = (await socket
        .timeout(APP_CONFIG.network.requestTimeoutMs)
        .emitWithAck(event, { ...payload, requestId })) as Ack<T>
      if (!ack.ok) throw new Error(ack.error.message)
      return ack.data
    } catch (error) {
      // 统一兜底与超时翻译来自 config/strings.ts，保持错误文案单一来源
      const message = error instanceof Error ? error.message : strings.request.genericFailure
      const timeoutMessage = message.includes('operation has timed out')
        ? strings.request.timeoutMessage
        : message
      // 绘图等高频事件失败时静默降级（本地画面由下一次权威快照校准），避免连续错误 Toast 刷屏
      if (!requestOptions.quiet) notify(timeoutMessage, 'error')
      throw error
    }
  }
}
