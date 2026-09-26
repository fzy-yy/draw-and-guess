/// <reference types="node" />
/**
 * 部署环境配置与校验：仅允许覆盖网络绑定、端口、日志级别、日志开关、日志保留条数、
 * 健康指标开关与分发产物浏览器自动打开开关。
 */
import { serverPrivateConfig } from './private.ts'

export type DeploymentConfig = {
  host: string
  port: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  /** 是否启用日志记录：false 时服务端完全不创建日志记录器、不写日志文件，节省内存。 */
  logEnabled: boolean
  /** 日志文件保留的最大条数（1～100）：每次启动新建一个，超出时删除最老的。 */
  logMaxFiles: number
  /** 仅允许本机 /api/health 返回详细进程指标；默认关闭。 */
  healthMetricsEnabled: boolean
  /** 分发产物启动后是否自动打开浏览器；默认开启，`0`/`false` 等显式关闭值均不打开（仅产物模式生效）。 */
  openBrowserEnabled: boolean
}

/**
 * 布尔型部署变量的统一解析口径：接受 true/1/yes/on 为开，其余显式值为关；
 * 未设置（空）时取默认值。`DRAW_GUESS_OPEN_BROWSER=0` 的历史用法由此保持兼容。
 */
function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase() ?? ''
  if (value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value)
}

/** 合并并基础校验部署覆盖；完整业务约束由服务端启动加载器继续验证。 */
export function getDeploymentConfig(env: NodeJS.ProcessEnv = process.env): DeploymentConfig {
  const port = env.PORT ? Number(env.PORT) : serverPrivateConfig.network.port
  const host = env.HOST?.trim() || serverPrivateConfig.network.host
  const candidateLevel = env.LOG_LEVEL?.trim() || 'info'
  // 类型谓词集中「字符串 → 合法日志级别」的收窄：调用点无需再各自 `as DeploymentConfig['logLevel']`
  const levels: readonly string[] = ['debug', 'info', 'warn', 'error']
  const isLogLevel = (value: string): value is DeploymentConfig['logLevel'] =>
    levels.includes(value)
  const logEnabled = parseBooleanEnv(env.LOG_ENABLED, true)
  const healthMetricsEnabled = parseBooleanEnv(env.HEALTH_METRICS_ENABLED, false)
  const openBrowserEnabled = parseBooleanEnv(env.DRAW_GUESS_OPEN_BROWSER, true)
  // 日志文件保留条数：默认 10，限定 1～100。
  const rawMaxFiles = env.LOG_MAX_FILES?.trim() || '10'
  const logMaxFiles = Number(rawMaxFiles)
  if (!Number.isInteger(logMaxFiles) || logMaxFiles < 1 || logMaxFiles > 100) {
    throw new Error(`LOG_MAX_FILES 必须是 1～100 的整数，当前值：${rawMaxFiles}`)
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT 必须是 1～65535 的整数，当前值：${String(env.PORT)}`)
  }
  if (!host) throw new Error('HOST 不能为空')
  if (!isLogLevel(candidateLevel)) {
    throw new Error(`LOG_LEVEL 仅支持 ${levels.join('、')}`)
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
