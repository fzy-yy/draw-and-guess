/**
 * 服务端文件日志管理器（基于 Pino 异步缓冲写入）。
 *
 * 遵循《后端架构规范》R4.4：
 * 1. 结构化 NDJSON 异步写入，不向标准输出输出业务日志（避免 Windows 控制台 GBK 乱码）；
 * 2. 每次启动新建一个以秒级时间戳命名的日志文件（app-YYYY-MM-DD-HH-mm-ss.log）；
 * 3. 严格执行历史日志轮转与文件保留上限（默认最多保留最近 10 份，启动时自动清理最旧日志）；
 * 4. 纵深防御脱敏：在进入 Pino 前通过静态白名单剥离非运维字段，并在 Pino 序列化器中屏蔽令牌与密码。
 */
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pino from 'pino'
import type { DeploymentConfig } from '../../core/config.ts'
import {
  SILENT_LOGGER,
  type RuntimeLogContext,
  type RuntimeLogMessage,
  type RuntimeLogger,
} from '../../core/errors.ts'

/** 默认服务端日志输出目录 */
const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../log')

/**
 * 生成当前秒级时间戳文件名（如 app-2026-10-06-16-00-00.log）。
 */
export function logFileName(): string {
  const date = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours(),
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `app-${stamp}.log`
}

/**
 * 准备日志存储目录并轮转清理旧日志。
 *
 * @param maxFiles 允许保留的最大日志文件份数
 * @param logDir 日志目录绝对路径
 * @returns 本次运行分配的最新日志文件路径
 */
export function prepareLogDir(maxFiles: number, logDir: string = LOG_DIR): string {
  mkdirSync(logDir, { recursive: true })
  const existing = new Set(readdirSync(logDir))
  const base = logFileName()
  let newPath = join(logDir, base)
  for (let suffix = 2; existing.has(basename(newPath)); suffix += 1) {
    newPath = join(logDir, base.replace(/\.log$/u, `-${suffix}.log`))
  }

  // 按文件物理创建时间（birthtime）升序排序，剔除最老的文件，避免同秒文件名按字典序错删
  const fileAge = (name: string): number => {
    const stat = statSync(join(logDir, name))
    return stat.birthtimeMs || stat.mtimeMs || 0
  }
  const logs = readdirSync(logDir)
    .filter((name) => name.endsWith('.log'))
    .sort((left, right) => fileAge(left) - fileAge(right))
  const excess = logs.length + 1 - maxFiles

  for (const stale of logs.slice(0, Math.max(0, excess))) {
    try {
      unlinkSync(join(logDir, stale))
    } catch {
      // 删除被其他进程锁定的旧文件时不阻断服务启动
    }
  }
  return newPath
}

/** 纵深防御二次屏蔽字段（若未经过 sanitize 直接写入时的底层兜底） */
const REDACTED_LOG_PATHS = [
  'answer',
  'chat',
  'message',
  'payload',
  'raw',
  'recoveryToken',
  'text',
  'token',
  'tokenDigest',
] as const

/**
 * 白名单上下文字段定义（静态编译期约束）。
 */
const SAFE_CONTEXT_KEYS: Record<keyof RuntimeLogContext, true> = {
  errorType: true,
  event: true,
  from: true,
  host: true,
  label: true,
  lanAddressCount: true,
  logPath: true,
  playerId: true,
  port: true,
  reason: true,
  retainedSeat: true,
  roomId: true,
  scope: true,
  signal: true,
  socketId: true,
  source: true,
  to: true,
  visibility: true,
}

/**
 * 上下文脱敏：仅保留白名单内的类型安全运维字段。
 */
function sanitizeContext(context: RuntimeLogContext): RuntimeLogContext {
  const safe: RuntimeLogContext = {}
  for (const key of Object.keys(SAFE_CONTEXT_KEYS) as Array<keyof RuntimeLogContext>) {
    const value = context[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value as never
    }
  }
  return safe
}

/**
 * 创建生产级异步文件日志器。
 *
 * @param deployment 部署配置
 * @param options 自定义路径选项（用于测试或打包运行）
 * @returns 统一 RuntimeLogger 实例
 */
export function makeLogger(
  deployment: DeploymentConfig,
  options: { logPath?: string; logDir?: string } = {},
): RuntimeLogger {
  if (!deployment.logEnabled) {
    return SILENT_LOGGER
  }

  const logPath = options.logPath ?? prepareLogDir(deployment.logMaxFiles, options.logDir)
  const destination = pino.destination({
    dest: logPath,
    sync: false,
    minLength: 4_096,
    periodicFlush: 1_000,
  })

  // 记录一次 destination 错误至标准错误，防止因无监听器引发未捕获异常退出
  let destinationErrorReported = false
  destination.on('error', () => {
    if (destinationErrorReported) return
    destinationErrorReported = true
    process.stderr.write('[logger] log destination error\n')
  })

  const logger = pino(
    {
      level: deployment.logLevel,
      redact: { paths: [...REDACTED_LOG_PATHS], remove: true },
    },
    destination,
  )

  logger.info({ logPath }, '日志文件已创建')

  const write =
    (level: 'info' | 'error') =>
    (context: RuntimeLogContext, message: RuntimeLogMessage): void =>
      void logger[level](sanitizeContext(context), message)

  let closePromise: Promise<void> | undefined

  const flush = (): Promise<void> =>
    new Promise((resolve, reject) => {
      destination.flush((error) => (error ? reject(error) : resolve()))
    })

  const close = (): Promise<void> => {
    closePromise ??= new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error)
      destination.once('error', onError)
      destination.once('finish', () => {
        destination.off('error', onError)
        resolve()
      })
      destination.end()
    })
    return closePromise
  }
  return {
    info: write('info'),
    error: write('error'),
    flush,
    close,
    flushSync: () => destination.flushSync(),
  }
}
