/**
 * 服务端错误类型与统一 ack 构造、运行日志接口。
 * 独立成文件避免游戏服务、回合流转、限频、协议绑定之间产生循环依赖。
 */
import type { Ack } from '@draw-guess/shared'
import { serverStrings } from '../../../string/index.ts'

/** 业务错误：带机器可读错误码，ack 回传时不会泄露内部堆栈。 */
export class GameError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** 运行日志只接受脱敏结构化上下文；生产入口注入 Pino，未注入时保持静默。 */
export interface RuntimeLogger {
  info(context: Record<string, unknown>, message: string): void
  error(context: Record<string, unknown>, message: string): void
}

/** 未注入日志器时的静默实现。 */
export const SILENT_LOGGER: RuntimeLogger = { info: () => undefined, error: () => undefined }

/** 创建请求成功回应，保证 requestId 原样返回供客户端核对。 */
export function success<T>(data: T, requestId: string): Ack<T> {
  return { ok: true, data, requestId }
}

/** 创建不泄露内部堆栈的失败回应；非业务错误统一归为 INTERNAL_ERROR。 */
export function failure(error: unknown, requestId: string): Ack<never> {
  return {
    ok: false,
    error: {
      code: error instanceof GameError ? error.code : 'INTERNAL_ERROR',
      // 未知异常可能包含路径、库错误或内部状态，统一返回固定文案避免泄露。
      message: error instanceof GameError ? error.message : serverStrings.errors.UNKNOWN_FAILURE,
    },
    requestId,
  }
}
