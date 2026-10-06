/**
 * 服务端统一配置中枢。
 *
 * 遵循《后端架构规范》R4.1：
 * 1. 环境变量与私有部署策略的唯一入口与唯一校验点；
 * 2. 启动期严格校验（Fail-Fast，遵循 docs/adr/0035-startup-config-fail-fast.md）：
 *    显式写下的配置只要写法或取值不对，一律在启动期中止并提供精确成因；
 * 3. 浏览器安全公开配置（PUBLIC_CONFIG）与服务端私有运行策略分离管理。
 */
import { isIP } from 'node:net'
import { APP_CONFIG as publicAppConfig, PUBLIC_CONFIG, type PublicConfig } from '@draw-guess/config'

/**
 * 日志级别合法取值白名单。
 */
export const LOG_LEVELS = ['info', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/**
 * 服务端私有领域策略。
 * 包含限频、断线宽限、词库扫描限制及内存预算，绝不泄漏给前端。
 */
export const serverPrivateConfig = {
  game: {
    gameResultMinSeconds: 5,
    gameResultAutoReturnSeconds: 20,
  },
  network: {
    host: '0.0.0.0',
    port: 5174,
    reconnectGraceMs: 120_000,
    /** 对局中房主断线后暂留控制权的宽限：到期仍未重连才把房主迁移给在线可玩成员 */
    hostReconnectGraceMs: 20_000,
    inviteExpiryMs: 30_000,
    inviteCooldownMs: 5_000,
    guessEventsPerSecond: 5,
    requestEventsPerSecond: 25,
    requestRateWindowMs: 1_000,
    /** 猜词/绘图等事件级滑动窗口宽度 */
    eventRateWindowMs: 1_000,
    idempotencyCacheMax: 100,
    /** Socket.IO 单条消息载荷上限（128 KiB） */
    maxHttpBufferBytes: 128 * 1024,
  },
  room: {
    privateJoinWindowMs: 10_000,
    privateJoinMaxAttempts: 5,
  },
  drawing: {
    maxDrawEventsPerSecond: 45,
  },
  vocabulary: {
    /** 目录扫描不到任何 .db 时的兜底词库文件名 */
    dbPath: 'vocabulary/base_words.db',
    maxWords: 10_000,
    maxAliasesPerWord: 8,
    maxAliasLength: 24,
    deduplicate: true,
    resetWhenExhausted: true,
  },
} as const

/**
 * 部署环境覆盖配置结构。
 */
export interface DeploymentConfig {
  /** 监听地址（IPv4 / IPv6 / RFC1123 主机名） */
  host: string
  /** 监听端口（1~65535） */
  port: number
  /** 日志级别（info / error） */
  logLevel: LogLevel
  /** 是否开启文件日志（关闭时零日志内存开销） */
  logEnabled: boolean
  /** 日志文件保留上限 */
  logMaxFiles: number
  /** 是否允许本机查看详细健康与性能指标 */
  healthMetricsEnabled: boolean
  /** 产物启动后是否自动打开浏览器（仅分发包模式生效） */
  openBrowserEnabled: boolean
}

/**
 * 布尔型部署环境变量的严格解析：只认 true / false（忽略大小写与首尾空白）。
 */
function parseBooleanEnv(name: string, raw: string | undefined, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase() ?? ''
  if (value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} 仅接受 true/false，当前值：${raw ?? ''}`)
}

function parseDecimalIntegerOrNull(raw: string): number | null {
  return /^\d+$/u.test(raw) ? Number(raw) : null
}

function parseListenPort(raw: string): number {
  const value = parseDecimalIntegerOrNull(raw)
  if (value === null) {
    throw new Error(
      `PORT 必须是纯十进制正整数（不支持十六进制、科学计数法、前导正号与小数），当前值：${raw}`,
    )
  }
  if (value < 1 || value > 65_535) {
    throw new Error(`PORT 必须是 1～65535 的整数，当前值：${raw}`)
  }
  return value
}

function isCanonicalHostname(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false
  return value
    .toLowerCase()
    .split('.')
    .every((label) => label.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/u.test(label))
}

function parseListenHost(raw: string): string {
  const bracketed = /^\[.*\]$/u.test(raw)
  const bare = bracketed ? raw.slice(1, -1) : raw
  const family = isIP(bare)
  if (family !== 0 && bare.includes('%')) {
    throw new Error(
      `HOST 不是合法的 IP 字面量（不支持带 scope-id 的 IPv6，绑定支持依赖平台），当前值：${raw}`,
    )
  }
  if (family === 6 || (family === 4 && !bracketed)) return raw
  if (bare.includes(':') || /^(?=.*\d)[\d.]+$/u.test(bare)) {
    throw new Error(
      `HOST 不是合法的 IP 字面量（支持 IPv4/IPv6，IPv6 可带外层方括号，不支持 scope-id），当前值：${raw}`,
    )
  }
  if (isCanonicalHostname(raw)) return raw
  throw new Error(
    `HOST 不是合法的主机名（点分段仅含字母数字与连字符、不以连字符开头或结尾、不能全为数字），当前值：${raw}`,
  )
}

export function getDeploymentConfig(env: NodeJS.ProcessEnv = process.env): DeploymentConfig {
  const rawPort = env.PORT?.trim() ?? ''
  const port = rawPort === '' ? serverPrivateConfig.network.port : parseListenPort(rawPort)
  const explicitHost = env.HOST?.trim() ?? ''
  const host =
    explicitHost === '' ? serverPrivateConfig.network.host : parseListenHost(explicitHost)
  const candidateLevel = env.LOG_LEVEL?.trim() || 'info'
  const isLogLevel = (value: string): value is LogLevel =>
    LOG_LEVELS.some((level) => level === value)
  const logEnabled = parseBooleanEnv('LOG_ENABLED', env.LOG_ENABLED, true)
  const healthMetricsEnabled = parseBooleanEnv(
    'HEALTH_METRICS_ENABLED',
    env.HEALTH_METRICS_ENABLED,
    false,
  )
  const openBrowserEnabled = parseBooleanEnv(
    'DRAW_GUESS_OPEN_BROWSER',
    env.DRAW_GUESS_OPEN_BROWSER,
    true,
  )
  const rawMaxFiles = env.LOG_MAX_FILES?.trim() || '10'
  const parsedMaxFiles = parseDecimalIntegerOrNull(rawMaxFiles)
  if (parsedMaxFiles === null) {
    throw new Error(
      `LOG_MAX_FILES 必须是纯十进制正整数（不支持十六进制、科学计数法、前导正号与小数），当前值：${rawMaxFiles}`,
    )
  }
  if (parsedMaxFiles < 1 || parsedMaxFiles > 100) {
    throw new Error(`LOG_MAX_FILES 必须是 1～100 的整数，当前值：${rawMaxFiles}`)
  }
  const logMaxFiles = parsedMaxFiles
  if (!isLogLevel(candidateLevel)) {
    throw new Error(`LOG_LEVEL 仅支持 ${LOG_LEVELS.join('、')}`)
  }
  return {
    host,
    port,
    logLevel: candidateLevel,
    logEnabled,
    logMaxFiles,
    healthMetricsEnabled,
    openBrowserEnabled,
  }
}

/**
 * 完整组装的服务端应用配置。
 * 在共享公开配置之上组合服务端私有策略与部署环境变量。
 */
export const APP_CONFIG = {
  ...publicAppConfig,
  game: { ...publicAppConfig.game, ...serverPrivateConfig.game },
  network: { ...publicAppConfig.network, ...serverPrivateConfig.network },
  room: { ...publicAppConfig.room, ...serverPrivateConfig.room },
  drawing: { ...publicAppConfig.drawing, ...serverPrivateConfig.drawing },
  vocabulary: { ...publicAppConfig.vocabulary, ...serverPrivateConfig.vocabulary },
} as const

export { PUBLIC_CONFIG, type PublicConfig }
