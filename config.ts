/// <reference types="node" />
/**
 * 项目唯一业务配置中心。
 *
 * 除部署环境中的端口、监听地址和日志级别外，所有可调整规则、文案、视觉令牌与限制都在此维护。
 * 前端构建通过 Vite 虚拟模块仅打包 PUBLIC_CONFIG，`/api/info` 也只返回同一公开子集，避免内部限制泄露。
 */

export const APP_CONFIG = {
  app: {
    name: '你画我猜',
    englishName: 'Draw and Guess',
    version: '2.1.0',
    protocolVersion: '3',
    storageKey: 'draw-and-guess-profile-v1',
    settingsStorageKey: 'draw-and-guess-settings-v1',
  },
  network: {
    host: '0.0.0.0',
    port: 5174,
    requestTimeoutMs: 8_000,
    reconnectGraceMs: 120_000,
    drawerReconnectGraceMs: 20_000,
    roomCleanupMs: 300_000,
    inviteExpiryMs: 30_000,
    inviteCooldownMs: 5_000,
    pingIntervalMs: 10_000,
    guessEventsPerSecond: 5,
  },
  player: {
    minPlayers: 2,
    maxPlayers: 6,
    defaultMaxPlayers: 6,
    nicknameMinLength: 1,
    nicknameMaxLength: 16,
    roomNameMaxLength: 24,
    chatMaxLength: 60,
    defaultNicknames: [
      '泡泡狐',
      '棉花喵',
      '竹叶熊',
      '星星兔',
      '布丁汪',
      '荷叶蛙',
      '齿轮仔',
      '月球客',
      '豆豆龙',
      '阳光鸡',
      '云朵熊',
      '小幽灵',
    ],
    /** 头像只使用安全的纯色圆形；客户端可通过颜色选择器提交同格式的任意颜色。 */
    avatarColors: [
      '#F97316',
      '#8B5CF6',
      '#334155',
      '#A16207',
      '#EC4899',
      '#CA8A04',
      '#16A34A',
      '#2563EB',
      '#0891B2',
      '#65A30D',
      '#EAB308',
      '#7C3AED',
    ],
    defaultAvatarColor: '#2563EB',
    colorPattern: '^#[0-9A-Fa-f]{6}$',
  },
  room: {
    defaultName: '快乐画室',
    allowPlayerInvite: true,
    allowPause: true,
    joinPolicy: 'next_game' as const,
  },
  game: {
    roundsPerPlayer: { min: 1, max: 5, default: 2, step: 1 },
    drawSeconds: { min: 45, max: 180, default: 90, step: 15 },
    chooseSeconds: { min: 10, max: 30, default: 15, step: 5 },
    optionCount: { min: 2, max: 5, default: 3, step: 1 },
    startingCountdownSeconds: 3,
    roundResultSeconds: 6,
    finalHintThresholds: [0.35, 0.2],
    showWordLength: true,
    progressiveHints: true,
    closeGuessEnabled: true,
    ignoreLatinCase: true,
    collapseSpaces: true,
    score: {
      guessBase: 300,
      maxSpeedBonus: 700,
      orderBonuses: [100, 60, 30, 0, 0],
      drawerPerCorrect: 120,
      drawerAllCorrectBonus: 100,
    },
  },
  drawing: {
    colors: [
      '#1F2937',
      '#EF4444',
      '#F97316',
      '#EAB308',
      '#22C55E',
      '#3B82F6',
      '#8B5CF6',
      '#FFFFFF',
    ],
    colorPattern: '^#[0-9A-Fa-f]{6}$',
    defaultColor: '#1F2937',
    /** 画笔与橡皮擦共用同一粗细值，画板滚轮按 wheelStep 连续调整。 */
    width: { min: 1, max: 30, default: 5, step: 1, wheelStep: 1 },
    /** 洪泛填充比较目标像素时允许的单通道误差，用于兼容 Canvas 抗锯齿边缘。 */
    fillTolerance: 8,
    batchIntervalMs: 24,
    maxPointsPerBatch: 120,
    maxDrawEventsPerSecond: 45,
    maxHistoryCommands: 1_500,
  },
  vocabulary: {
    filePath: 'vocabulary.md',
    encoding: 'utf8' as const,
    minWords: 12,
    maxWordLength: 24,
    deduplicate: true,
    resetWhenExhausted: true,
  },
  audio: {
    cues: {
      room: { frequencies: [440, 560], duration: 0.1 },
      ready: { frequencies: [620], duration: 0.12 },
      starting: { frequencies: [440, 440, 660], duration: 0.1 },
      drawing: { frequencies: [520, 700], duration: 0.12 },
      correct: { frequencies: [660, 880, 1040], duration: 0.12 },
      warning: { frequencies: [330], duration: 0.08 },
      result: { frequencies: [520, 660], duration: 0.16 },
      final: { frequencies: [523, 659, 784, 1046], duration: 0.16 },
      invite: { frequencies: [740, 880], duration: 0.13 },
    },
    synthesizedGain: 0.13,
  },
  localSettings: {
    masterVolume: 0.8,
    soundVolume: 0.8,
    musicVolume: 0.35,
    muted: false,
    colorFriendly: false,
    showShortcuts: true,
    /** 工具快捷键只保存单个可打印字符；客户端会阻止重复键覆盖其他工具。 */
    penShortcut: 'b',
    eraserShortcut: 'e',
    fillShortcut: 'f',
    autoFocusGuess: true,
    discoverable: true,
    acceptsInvites: true,
  },
  ui: {
    stageAspectRatio: '16 / 9',
    toastDurationMs: 3_200,
    recentMessageCount: 8,
  },
  presets: {
    safeChat: ['画得真棒！', '我知道了！', '再来一点提示', '好难猜呀'],
  },
} as const

/** 部署环境仅允许覆盖网络绑定和日志级别，不形成第二份业务配置。 */
export type DeploymentConfig = {
  host: string
  port: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

/** 合并并基础校验部署覆盖；完整业务约束由服务端启动加载器继续验证。 */
export function getDeploymentConfig(env: NodeJS.ProcessEnv = process.env): DeploymentConfig {
  const port = env.PORT ? Number(env.PORT) : APP_CONFIG.network.port
  const host = env.HOST?.trim() || APP_CONFIG.network.host
  const candidateLevel = env.LOG_LEVEL?.trim() || 'info'
  const levels: DeploymentConfig['logLevel'][] = ['debug', 'info', 'warn', 'error']
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT 必须是 1～65535 的整数，当前值：${String(env.PORT)}`)
  }
  if (!host) throw new Error('HOST 不能为空')
  if (!levels.includes(candidateLevel as DeploymentConfig['logLevel'])) {
    throw new Error(`LOG_LEVEL 仅支持 ${levels.join('、')}`)
  }
  return { host, port, logLevel: candidateLevel as DeploymentConfig['logLevel'] }
}

/** 可安全返回给浏览器的配置子集，不含服务端频率限制与内部清理策略。 */
export const PUBLIC_CONFIG = {
  app: APP_CONFIG.app,
  network: {
    requestTimeoutMs: APP_CONFIG.network.requestTimeoutMs,
    pingIntervalMs: APP_CONFIG.network.pingIntervalMs,
    recoveryTokenLifetimeMs: APP_CONFIG.network.reconnectGraceMs,
  },
  player: APP_CONFIG.player,
  room: APP_CONFIG.room,
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
