/// <reference types="node" />
/**
 * 部署环境配置与校验：仅允许覆盖网络绑定、端口、日志级别、日志开关与日志保留条数。
 */
import { network } from './app.ts'

export type DeploymentConfig = {
  host: string
  port: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  /** 是否启用日志记录：false 时服务端完全不创建日志记录器、不写日志文件，节省内存。 */
  logEnabled: boolean
  /** 日志文件保留的最大条数（1～100）：每次启动新建一个，超出时删除最老的。 */
  logMaxFiles: number
}

/** 合并并基础校验部署覆盖；完整业务约束由服务端启动加载器继续验证。 */
export function getDeploymentConfig(env: NodeJS.ProcessEnv = process.env): DeploymentConfig {
  const port = env.PORT ? Number(env.PORT) : network.port
  const host = env.HOST?.trim() || network.host
  const candidateLevel = env.LOG_LEVEL?.trim() || 'info'
  const levels: DeploymentConfig['logLevel'][] = ['debug', 'info', 'warn', 'error']
  // 日志开关：默认开启；接受 true/1/yes/on 为开，其余显式值视为关。
  const rawEnabled = env.LOG_ENABLED?.trim().toLowerCase() ?? ''
  const logEnabled = rawEnabled === '' ? true : ['1', 'true', 'yes', 'on'].includes(rawEnabled)
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
  if (!levels.includes(candidateLevel as DeploymentConfig['logLevel'])) {
    throw new Error(`LOG_LEVEL 仅支持 ${levels.join('、')}`)
  }
  return {
    host,
    port,
    logLevel: candidateLevel as DeploymentConfig['logLevel'],
    logEnabled,
    logMaxFiles,
  }
}
