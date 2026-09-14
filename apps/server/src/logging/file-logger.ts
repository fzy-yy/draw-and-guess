import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pino from 'pino'
import type { DeploymentConfig } from '../config/index.ts'
import {
  SILENT_LOGGER,
  type RuntimeLogContext,
  type RuntimeLogMessage,
  type RuntimeLogger,
} from '../errors.ts'

const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../log')

export function logFileName(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours(),
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `app-${stamp}.log`
}

export function prepareLogDir(maxFiles: number): string {
  mkdirSync(LOG_DIR, { recursive: true })
  const existing = new Set(readdirSync(LOG_DIR))
  const base = logFileName()
  let newPath = join(LOG_DIR, base)
  for (let suffix = 2; existing.has(basename(newPath)); suffix += 1)
    newPath = join(LOG_DIR, base.replace(/\.log$/u, `-${suffix}.log`))
  // 按文件创建时间升序删最旧：绝对不能按文件名排序，因为同秒文件名 `-10.log < -2.log`，
  // 会让字典序把后创建的文件当作更旧删除（见 docs/adr/0005-log-retention-order.md）。
  const fileAge = (name: string): number => {
    const stat = statSync(join(LOG_DIR, name))
    // birthtime 为创建时间；极少数不支持的文件系统回退 mtime。
    return stat.birthtimeMs || stat.mtimeMs || 0
  }
  const logs = readdirSync(LOG_DIR)
    .filter((name) => name.endsWith('.log'))
    .sort((left, right) => fileAge(left) - fileAge(right))
  const excess = logs.length + 1 - maxFiles
  for (let index = 0; index < excess; index += 1) unlinkSync(join(LOG_DIR, logs[index]!))
  return newPath
}

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

const SAFE_CONTEXT_KEYS = [
  'errorType',
  'event',
  'from',
  'host',
  'label',
  'lanAddressCount',
  'logPath',
  'playerId',
  'port',
  'reason',
  'retainedSeat',
  'roomId',
  'scope',
  'signal',
  'source',
  'to',
  'visibility',
  'waitingForNextGame',
] as const satisfies readonly (keyof RuntimeLogContext)[]

function sanitizeContext(context: RuntimeLogContext): RuntimeLogContext {
  const safe: RuntimeLogContext = {}
  for (const key of SAFE_CONTEXT_KEYS) {
    const value = context[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      Object.assign(safe, { [key]: value })
    }
  }
  return safe
}

/** 创建异步文件日志器；logPath 注入仅供隔离测试，不改变生产日志保留策略。 */
export function makeLogger(
  deployment: DeploymentConfig,
  options: { logPath?: string } = {},
): RuntimeLogger {
  if (!deployment.logEnabled) return SILENT_LOGGER
  const logPath = options.logPath ?? prepareLogDir(deployment.logMaxFiles)
  const destination = pino.destination({
    dest: logPath,
    sync: false,
    minLength: 4_096,
    periodicFlush: 1_000,
  })
  const logger = pino(
    {
      level: deployment.logLevel,
      redact: { paths: [...REDACTED_LOG_PATHS], remove: true },
    },
    destination,
  )
  logger.info({ logPath }, '日志文件已创建')
  let closePromise: Promise<void> | undefined

  const flush = (): Promise<void> =>
    new Promise((resolve, reject) =>
      destination.flush((error) => (error ? reject(error) : resolve())),
    )

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

  const write =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (context: RuntimeLogContext, message: RuntimeLogMessage): void =>
      void logger[level](sanitizeContext(context), message)

  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    flush,
    close,
    flushSync: () => destination.flushSync(),
  }
}
