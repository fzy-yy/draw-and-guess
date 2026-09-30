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

/** 生成当前秒级时间戳文件名；同秒重复启动的冲突由 prepareLogDir 追加数值后缀消解。 */
export function logFileName(): string {
  const date = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours(),
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `app-${stamp}.log`
}

export function prepareLogDir(maxFiles: number, logDir: string = LOG_DIR): string {
  mkdirSync(logDir, { recursive: true })
  const existing = new Set(readdirSync(logDir))
  const base = logFileName()
  let newPath = join(logDir, base)
  for (let suffix = 2; existing.has(basename(newPath)); suffix += 1)
    newPath = join(logDir, base.replace(/\.log$/u, `-${suffix}.log`))
  // 按文件创建时间升序删最旧：绝对不能按文件名排序，因为同秒文件名 `-10.log < -2.log`，
  // 会让字典序把后创建的文件当作更旧删除（见 docs/adr/0005-log-retention-order.md）。
  const fileAge = (name: string): number => {
    const stat = statSync(join(logDir, name))
    // birthtime 为创建时间；极少数不支持的文件系统回退 mtime。
    return stat.birthtimeMs || stat.mtimeMs || 0
  }
  const logs = readdirSync(logDir)
    .filter((name) => name.endsWith('.log'))
    .sort((left, right) => fileAge(left) - fileAge(right))
  const excess = logs.length + 1 - maxFiles
  // excess ∈ [0, logs.length]（maxFiles ≥ 1），slice 取最旧 excess 个删除，避免 `logs[index]!` 断言
  for (const stale of logs.slice(0, Math.max(0, excess))) {
    try {
      unlinkSync(join(logDir, stale))
    } catch {
      // 删除失败（Windows 上另一实例占用会抛 EBUSY/EPERM）不阻断启动：
      // 宁可多留一个旧日志，也不让日志保留策略把服务挡在启动门外。
    }
  }
  return newPath
}

// 纵深防御的第二层：所有日志上下文在写入前都先经 sanitizeContext 剥离非白名单键，
// 因此这些 redact 路径在正常情况下不会命中；保留它是为防止 sanitize 被绕过、
// 或未来新增不经 sanitizeContext 的直写路径时仍有一道兜底（主防线是白名单，不是 redact）。
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
 * 白名单上下文字段的穷尽登记：`satisfies Record<keyof RuntimeLogContext, true>` 让
 * 「漏登记一个字段」与「登记不存在的字段」都在编译期失败，杜绝新增日志字段被静默丢弃
 * （曾发生 memberId 被丢的事故）。新增 RuntimeLogContext 字段必须同步在此登记。
 */
const SAFE_CONTEXT_KEYS = {
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
  source: true,
  to: true,
  visibility: true,
} satisfies Record<keyof RuntimeLogContext, true>

function sanitizeContext(context: RuntimeLogContext): RuntimeLogContext {
  const safe: RuntimeLogContext = {}
  // Object.keys 只能推导出 string[]；键集合已由 satisfies 穷尽约束（多键/漏键都会编译失败），
  // 因此这里的断言是安全的。
  for (const key of Object.keys(SAFE_CONTEXT_KEYS) as Array<keyof RuntimeLogContext>) {
    const value = context[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      Object.assign(safe, { [key]: value })
    }
  }
  return safe
}

/** 创建异步文件日志器；logPath / logDir 注入仅供隔离测试与分发产物数据目录使用，不改变生产日志保留策略。 */
export function makeLogger(
  deployment: DeploymentConfig,
  options: { logPath?: string; logDir?: string } = {},
): RuntimeLogger {
  if (!deployment.logEnabled) return SILENT_LOGGER
  const logPath = options.logPath ?? prepareLogDir(deployment.logMaxFiles, options.logDir)
  const destination = pino.destination({
    dest: logPath,
    sync: false,
    minLength: 4_096,
    periodicFlush: 1_000,
  })
  // 常驻 error 监听是「日志系统自身故障」的最后手段：业务日志刻意不写控制台
  // （规避 Windows 控制台 GBK 解码 UTF-8 中文乱码），但 destination 运行期写失败
  // （磁盘满、文件被删）时 SonicBoom 会 emit('error')，无监听器时 EventEmitter
  // 会把它升级成 uncaughtException 直接拖垮服务。这里只把第一次故障以 ASCII 告警
  // 写 stderr（ASCII 不涉及中文，避免乱码），避免磁盘满时每次写失败都刷屏。
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
    (level: 'info' | 'error') =>
    (context: RuntimeLogContext, message: RuntimeLogMessage): void =>
      void logger[level](sanitizeContext(context), message)

  return {
    info: write('info'),
    error: write('error'),
    flush,
    close,
    flushSync: () => destination.flushSync(),
  }
}
