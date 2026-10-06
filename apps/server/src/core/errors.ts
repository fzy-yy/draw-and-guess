/**
 * 服务端统一错误模型与响应构造。
 *
 * 遵循《后端架构规范》R4.3：
 * 1. 采用 AppError 类层级表达错误，code 为唯一对外契约，不以 message 作为判断依据；
 * 2. 区分可预期业务错误（expose=true）与未预期系统异常（expose=false），防止服务端敏感信息外泄；
 * 3. 完美兼容 RFC 9457 HTTP Problem Details 与 Socket.IO 结构化 ACK 信封；
 * 4. 内置 SQLite 错误码自动转换（唯一性冲突映射为 409，其余底层故障映射为 503）。
 */
import { ERROR_CODES, type Ack, type ErrorCode } from '@draw-guess/shared'
import { serverErrorMessages } from '@draw-guess/strings'

/**
 * 创建 AppError 实例的配置参数。
 */
export interface AppErrorOptions {
  /** 错误描述消息（业务错误将回传给前端，内部错误对外部脱敏） */
  message: string
  /** 稳定错误码（唯一对外机器可读标识） */
  code: ErrorCode
  /** HTTP 响应状态码（遵循 4xx/5xx 标准语义） */
  status?: number
  /** 是否允许错误详情与描述出网（默认 true，系统异常必须显式设为 false） */
  expose?: boolean
  /** 结构化错误明细（如校验失败字段树） */
  details?: unknown
  /** 引起该错误的原始原因（保持 ES2022 错误链） */
  cause?: unknown
}

/**
 * 全局统一错误基类。
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly expose: boolean
  readonly details?: unknown

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause })
    this.name = new.target.name
    this.code = options.code
    this.status = options.status ?? 400
    this.expose = options.expose ?? true
    this.details = options.details
    Error.captureStackTrace?.(this, new.target)
  }

  /**
   * 序列化为 RFC 9457 Problem Details (application/problem+json)。
   */
  toProblem(requestId: string): Record<string, unknown> {
    return {
      type: `https://errors.example.com/${this.code}`,
      title: this.expose ? this.message : '服务器内部错误',
      status: this.status,
      code: this.code,
      ...(this.expose && this.details !== undefined ? { errors: this.details } : {}),
      instance: requestId,
    }
  }

  /**
   * 序列化为 Socket.IO 统一 ACK 错误信封。
   */
  toAck(requestId: string): Ack<never> {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.expose ? this.message : serverErrorMessages[ERROR_CODES.INTERNAL_ERROR],
      },
      requestId,
    }
  }
}

/**
 * 业务错误统一类：继承 AppError，并作为所有可预期业务异常的通用基类。
 */
export class GameError extends AppError {
  constructor(
    code: ErrorCode,
    message: string = serverErrorMessages[code] ?? code,
    cause?: unknown,
    status = 400,
    details?: unknown,
  ) {
    super({
      message,
      code,
      status,
      expose: true,
      details,
      cause,
    })
  }
}

/**
 * 资源未找到错误（404）。
 */
export class NotFoundError extends GameError {
  constructor(message: string, code: ErrorCode = ERROR_CODES.NOT_FOUND, cause?: unknown) {
    super(code, message, cause, 404)
  }
}

/**
 * 状态冲突错误（409，如版本冲突、昵称重复、已在房间中等）。
 */
export class ConflictError extends GameError {
  constructor(message: string, code: ErrorCode = ERROR_CODES.VERSION_CONFLICT, cause?: unknown) {
    super(code, message, cause, 409)
  }
}

/**
 * 请求输入校验失败错误（422）。
 */
export class ValidationError extends GameError {
  constructor(
    message: string = serverErrorMessages[ERROR_CODES.INVALID_PAYLOAD],
    details?: unknown,
    cause?: unknown,
  ) {
    super(ERROR_CODES.INVALID_PAYLOAD, message, cause, 422, details)
  }
}

/**
 * 未认证错误（401）。
 */
export class UnauthorizedError extends GameError {
  constructor(message: string = serverErrorMessages[ERROR_CODES.UNAUTHORIZED], cause?: unknown) {
    super(ERROR_CODES.UNAUTHORIZED, message, cause, 401)
  }
}

/**
 * 权限不足/禁止访问错误（403）。
 */
export class ForbiddenError extends GameError {
  constructor(
    message: string = serverErrorMessages[ERROR_CODES.FORBIDDEN],
    code: ErrorCode = ERROR_CODES.FORBIDDEN,
    cause?: unknown,
  ) {
    super(code, message, cause, 403)
  }
}

/**
 * 限频拒绝错误（429）。
 */
export class RateLimitError extends GameError {
  constructor(message: string = serverErrorMessages[ERROR_CODES.RATE_LIMITED], cause?: unknown) {
    super(ERROR_CODES.RATE_LIMITED, message, cause, 429)
  }
}
/**
 * 服务器内部错误（500，严格脱敏）。
 */
export class InternalError extends AppError {
  constructor(cause?: unknown) {
    super({
      message: serverErrorMessages[ERROR_CODES.INTERNAL_ERROR],
      code: ERROR_CODES.INTERNAL_ERROR,
      status: 500,
      expose: false,
      cause,
    })
  }
}

/** 提取 better-sqlite3 的错误码（SQLITE_* 字符串） */
function sqliteCodeOf(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.startsWith('SQLITE_') ? code : undefined
}

/**
 * 将任意未知异常收敛为规范的 AppError 实例。
 * - 已经是 AppError：直接返回；
 * - SQLite 唯一约束冲突：自动映射为 409 业务冲突；
 * - 其余底层异常：收敛为 500 InternalError 并隐蔽调用栈与敏感信息。
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }

  const sqliteCode = sqliteCodeOf(error)
  if (sqliteCode !== undefined) {
    const isConstraint =
      sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE' || sqliteCode === 'SQLITE_CONSTRAINT_PRIMARYKEY'
    if (isConstraint) {
      return new ConflictError('数据已存在，违反唯一性约束', ERROR_CODES.DUPLICATE_NICKNAME, error)
    }
    return new AppError({
      message: '存储服务暂时不可用',
      code: ERROR_CODES.INTERNAL_ERROR,
      status: 503,
      expose: false,
      cause: error,
    })
  }

  return new InternalError(error)
}

/**
 * 成功 ACK 响应构造器。
 * 将处理结果打包为规范信封，并原样回传客户端 requestId。
 */
export function success<T>(data: T, requestId: string): Ack<T> {
  return { ok: true, data, requestId }
}

/**
 * 失败 ACK 响应构造器。
 * 将捕获的错误规范化后打包为统一失败信封，绝不泄漏未预期内部堆栈。
 */
export function failure(error: unknown, requestId: string): Ack<never> {
  const appError = toAppError(error)
  return appError.toAck(requestId)
}

/**
 * 日志上下文脱敏字段白名单（严禁收录正文、密码、令牌或聊天内容）。
 */
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
  socketId?: string
  source?: string
  to?: string
  visibility?: string
}
/**
 * 代码内静态白名单日志消息（禁止拼接不可信输入）。
 */
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

/**
 * 服务端结构化运行日志接口。
 */
export interface RuntimeLogger {
  info(context: RuntimeLogContext, message: RuntimeLogMessage): void
  error(context: RuntimeLogContext, message: RuntimeLogMessage): void
  flush(): Promise<void>
  close(): Promise<void>
  flushSync(): void
}
/**
 * 默认静默日志实现（在测试或无日志环境下使用）。
 */
export const SILENT_LOGGER: RuntimeLogger = {
  info(): void {},
  error(): void {},
  flush: async () => {},
  close: async () => {},
  flushSync: () => {},
}
/**
 * 安全提取错误类型名（避免直接打印未知对象）。
 */
export function runtimeErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}
