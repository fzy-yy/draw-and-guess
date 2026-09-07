import { EVENTS, createServerPush } from '@draw-guess/shared'
import { serverStrings } from '../../../../string/index.ts'
import type { createApplication } from '../app.ts'
import { closeDb } from '../db/index.ts'
import type { RuntimeLogger } from '../errors.ts'

type Application = Awaited<ReturnType<typeof createApplication>>

/** 注册一次性进程信号处理器，先通知客户端再关闭数据库、Socket 与 HTTP。 */
export function registerShutdown(application: Application, logger: RuntimeLogger): void {
  const shutdown = (signal: string): void => {
    logger.info({ signal }, '正在优雅关闭服务')
    application.io.emit(
      EVENTS.systemError,
      createServerPush({ text: serverStrings.notices.serverShutdown }),
    )
    application.io.close(() => {
      closeDb()
      application.httpServer.close(() => process.exit(0))
    })
    setTimeout(() => process.exit(1), 3_000).unref()
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}
