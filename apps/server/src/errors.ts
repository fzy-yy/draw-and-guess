/**
 * 服务端错误类型与统一 ack 构造、运行日志接口。
 * 独立成文件避免游戏服务、回合流转、限频、协议绑定之间产生循环依赖。
 */
import { ERROR_CODES, type Ack, type ErrorCode } from '@draw-guess/shared'
import { serverErrorMessages } from '@draw-guess/strings'

/** 业务错误：带机器可读错误码，ack 回传时不会泄露内部堆栈。 */
export class GameError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string = serverErrorMessages[code],
  ) {
    super(message)
  }
}

/** 日志上下文仅允许这些运维字段；类型层拒绝 payload、token、答案、聊天正文与任意文本。 */
export interface RuntimeLogContext {
  errorType?: string
  event?: string
  from?: string
  host?: string
  label?: string
  lanAddressCount?: number
  logPath?: string
  playerId?: string
  port?: number
  reason?: string
  retainedSeat?: boolean
  roomId?: string
  scope?: string
  signal?: string
  source?: string
  to?: string
  visibility?: string
}

/** 日志消息采用代码内静态白名单，禁止把用户输入或异常 message 当作日志正文。 */
export type RuntimeLogMessage =
  | '日志文件已创建'
  | '服务关闭失败'
  | '正在优雅关闭服务'
  | '未预期的服务器内部错误'
  | '战绩落盘失败，已保障结算广播正常进行'
  | '端口已被占用'
  | '服务器启动失败'
  | '服务启动校验失败'
  | '局域网服务监听成功'
  | '房间已创建'
  | '玩家已加入房间'
  | '玩家已离开房间'
  | '玩家主动退出当前对局并保留成绩卡'
  | '玩家在同一连接上重复注册，已复用身份'
  | '玩家会话已注册'
  | '玩家身份已从持久化记录恢复'
  | '玩家注销离房失败'
  | '清理玩家持久化记录失败'
  | '断线状态持久化异常'
  | '玩家对局阶段断线并保留席位'
  | '玩家断线并进入身份恢复宽限'
  | '房间阶段已转换'

/** 运行日志只接受脱敏结构化上下文；生产入口注入 Pino，未注入时保持静默。通道只保留有真实调用者的两级（info/error）。 */
export interface RuntimeLogger {
  info(context: RuntimeLogContext, message: RuntimeLogMessage): void
  error(context: RuntimeLogContext, message: RuntimeLogMessage): void
  /** 正常关闭前异步排空缓冲区。 */
  flush(): Promise<void>
  /** 结束 destination；可重复调用。 */
  close(): Promise<void>
  /** 仅供即将 process.exit 的异常路径尽力同步落盘。 */
  flushSync(): void
}

/** 未注入日志器时的静默实现。 */
export const SILENT_LOGGER: RuntimeLogger = {
  info: () => undefined,
  error: () => undefined,
  flush: () => Promise.resolve(),
  close: () => Promise.resolve(),
  flushSync: () => undefined,
}

/** 错误日志只保留类型，不序列化 message、stack 或可能夹带请求内容的自定义字段。 */
export function runtimeErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

/** 创建请求成功回应，保证 requestId 原样返回供客户端核对。 */
export function success<T>(data: T, requestId: string): Ack<T> {
  return { ok: true, data, requestId }
}

/** 创建不泄露内部堆栈的失败回应；非业务错误统一归为 INTERNAL_ERROR。 */
export function failure(error: unknown, requestId: string): Ack<never> {
  return {
    ok: false,
    error: {
      code: error instanceof GameError ? error.code : ERROR_CODES.INTERNAL_ERROR,
      // 未知异常可能包含路径、库错误或内部状态，统一返回固定文案避免泄露。
      message: error instanceof GameError ? error.message : serverErrorMessages.INTERNAL_ERROR,
    },
    requestId,
  }
}
