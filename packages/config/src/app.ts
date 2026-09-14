import { PROTOCOL_VERSION } from '@draw-guess/shared/protocol/constants'

/**
 * 领域配置：应用标识与浏览器连接参数；服务端监听、限频和清理策略由服务端私有配置维护。
 */
export const app = {
  name: '你画我猜',
  version: '2.3.0',
  protocolVersion: PROTOCOL_VERSION, // 服务端主动推送改为版本化信封并增加完整运行时解码，不匹配时拒绝注册
  storageKey: 'draw-and-guess-profile-v1', // localStorage 资料键
  settingsStorageKey: 'draw-and-guess-settings-v1', // localStorage 设置键
  fullscreenPromptSessionKey: 'draw-and-guess-fullscreen-prompt-v1', // sessionStorage 全屏提示记录键
} as const

export const network = {
  requestTimeoutMs: 8_000, // 客户端请求超时
  requestRetryAttempts: 1, // 普通幂等请求发生传输故障时自动重试次数（复用同一 requestId）
  requestRetryDelayMs: 250, // 自动重试前短暂等待，让 Socket.IO 有机会完成快速重连
  stateResyncCooldownMs: 1_000, // 非法/缺口推送触发全量重同步的最小间隔
  sessionRestoreRetryMs: 2_000, // 传输已恢复但会话注册 ack 失败时的静默重试间隔
  pingIntervalMs: 10_000, // Socket.IO 心跳与延迟测量周期
  /**
   * 网络按钮延迟档位阈值（毫秒，局域网语义）：
   * 测得往返延迟 ≤ latencyGoodMs 显示绿色（连接良好）；
   * 大于该值显示橙色（网络较慢）；断线时无论延迟为何值一律显示红色。
   * 阈值远大于局域网典型延迟（<10ms），留出抖动余量的同时能感知到明显的网络劣化。
   */
  latencyGoodMs: 80,
} as const
