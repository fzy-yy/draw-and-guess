/// <reference types="node" />
/**
 * 项目唯一业务配置中心（聚合）。
 *
 * 各领域配置按 app/network/player/room/game/drawing/vocabulary/audio/localSettings/ui/presets
 * 拆分在 config/ 目录内，这里统一组装成 APP_CONFIG 并导出部署覆盖与公开子集，保持引用路径不变。
 * 除部署环境中的端口、监听地址和日志级别外，所有可调整规则、文案、视觉令牌与限制都在此维护。
 * 前端构建通过 Vite 虚拟模块仅打包 PUBLIC_CONFIG，`/api/info` 也只返回同一公开子集，避免内部限制泄露。
 *
 * UI 展示文案不走本聚合：统一管理在 config/strings.ts（含模板函数，无法 JSON 序列化进公开子集），
 * 客户端经 @draw-guess/strings 别名导入、服务端经相对路径导入，见该文件头部说明。
 */
import { app, network } from './config/app.ts'
import { player } from './config/player.ts'
import { room } from './config/room.ts'
import { game } from './config/game.ts'
import { drawing } from './config/drawing.ts'
import { vocabulary } from './config/vocabulary.ts'
import { audio } from './config/audio.ts'
import { localSettings, presets, ui } from './config/settings.ts'

/** 领域配置合并为唯一业务配置对象。 */
export const APP_CONFIG = {
  app,
  network,
  player,
  room: room,
  game,
  drawing,
  vocabulary,
  audio,
  localSettings,
  ui,
  presets,
} as const

/** 部署环境仅允许覆盖网络绑定、日志级别、日志开关与日志保留条数，不形成第二份业务配置。 */
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
  const port = env.PORT ? Number(env.PORT) : APP_CONFIG.network.port
  const host = env.HOST?.trim() || APP_CONFIG.network.host
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

/** 可安全返回给浏览器的配置子集，不含服务端频率限制与内部清理策略。 */
export const PUBLIC_CONFIG = {
  app: APP_CONFIG.app,
  network: {
    requestTimeoutMs: APP_CONFIG.network.requestTimeoutMs,
    pingIntervalMs: APP_CONFIG.network.pingIntervalMs,
    sessionRestoreRetryMs: APP_CONFIG.network.sessionRestoreRetryMs,
    latencyGoodMs: APP_CONFIG.network.latencyGoodMs,
  },
  player: APP_CONFIG.player,
  room: {
    defaultName: APP_CONFIG.room.defaultName,
    seatColors: APP_CONFIG.room.seatColors,
    allowPlayerInvite: APP_CONFIG.room.allowPlayerInvite,
    allowPause: APP_CONFIG.room.allowPause,
    joinPolicy: APP_CONFIG.room.joinPolicy,
    privateCodeLength: APP_CONFIG.room.privateCodeLength,
  },
  game: APP_CONFIG.game,
  drawing: APP_CONFIG.drawing,
  audio: APP_CONFIG.audio,
  vocabulary: {
    minWords: APP_CONFIG.vocabulary.minWords,
    maxWordLength: APP_CONFIG.vocabulary.maxWordLength,
  },
  localSettings: APP_CONFIG.localSettings,
  ui: APP_CONFIG.ui,
  presets: APP_CONFIG.presets,
} as const

export type PublicConfig = typeof PUBLIC_CONFIG
