import { EVENTS, createServerPush } from '@draw-guess/shared'
import { serverStrings } from '@draw-guess/strings'
import type { createApplication } from '../app.ts'
import type { RuntimeLogger } from '../errors.ts'
import { runtimeErrorType } from '../errors.ts'

type Application = Awaited<ReturnType<typeof createApplication>>

/** 关闭应用资源后排空并结束异步日志 destination；任一阶段失败都返回异常退出码。 */
export async function shutdownApplication(
  application: Application,
  logger: RuntimeLogger,
): Promise<0 | 1> {
  let failed = false
  try {
    await application.close()
  } catch (error) {
    failed = true
    logger.error({ errorType: runtimeErrorType(error) }, '服务关闭失败')
  }
  try {
    await logger.flush()
  } catch {
    failed = true
    // 异步排空失败时只做最后一次同步尝试，但仍继续 close 释放文件句柄。
    try {
      logger.flushSync()
    } catch {
      // 文件系统已不可用时只能交给退出码表达失败。
    }
  }
  try {
    await logger.close()
  } catch {
    failed = true
  }
  return failed ? 1 : 0
}

/** 注册一次性进程信号处理器，先通知客户端再关闭数据库、Socket 与 HTTP。 */
export function registerShutdown(application: Application, logger: RuntimeLogger): void {
  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, '正在优雅关闭服务')
    application.io.emit(
      EVENTS.systemError,
      createServerPush(EVENTS.systemError, { text: serverStrings.notices.serverShutdown }),
    )
    const forcedExit = setTimeout(() => {
      try {
        logger.flushSync()
      } finally {
        process.exit(1)
      }
    }, 3_000)
    forcedExit.unref()
    void shutdownApplication(application, logger).then((exitCode) => {
      clearTimeout(forcedExit)
      process.exit(exitCode)
    })
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}
