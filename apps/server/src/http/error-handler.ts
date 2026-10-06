/**
 * 统一 HTTP 错误处理中间件。
 *
 * 遵循《后端架构规范》R4.3d：
 * 1. 唯一错误出口：捕获全部路由抛出的错误，序列化为 RFC 9457 Problem Details (application/problem+json)；
 * 2. 保证每个响应携带 X-Request-Id，且与错误体中的 instance 字段一致；
 * 3. 响应头已发出时交由 Express 默认处理，避免连接悬挂。
 */
import { randomUUID } from 'node:crypto'
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express'
import { toAppError, type RuntimeLogger, SILENT_LOGGER } from '../core/errors.ts'

/**
 * 创建符合 RFC 9457 标准的全局错误处理中间件。
 *
 * @param logger 运行时日志记录器
 * @returns Express 4 参数错误处理中间件
 */
export function createErrorHandler(logger: RuntimeLogger = SILENT_LOGGER): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(err)
      return
    }

    const assignedId = req.headers['x-request-id']
    const requestId =
      typeof assignedId === 'string' && assignedId.length > 0 ? assignedId : randomUUID()
    res.setHeader('X-Request-Id', requestId)

    const appError = toAppError(err)
    if (appError.status >= 500) {
      logger.error(
        {
          errorType: appError.name,
          scope: 'http',
          reason: appError.code,
        },
        '未预期的服务器内部错误',
      )
    }

    res.status(appError.status).type('application/problem+json').json(appError.toProblem(requestId))
  }
}
