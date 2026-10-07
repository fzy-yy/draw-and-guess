import { PROTOCOL_VERSION } from '@draw-guess/shared/protocol/constants'

/**
 * 领域配置：应用标识与浏览器连接参数；服务端监听、限频和清理策略由服务端私有配置维护。
 */
export const app = {
  /** 应用名：浏览器标题、诊断信息与无障碍标签中展示的「你画我猜」。 */
  name: '你画我猜',
  /** 产品版本号：分发包产物命名与 /api/info 都读它，是应用版本的唯一权威源。 */
  version: '1.0.0',
  /** 线上协议版本：与服务端不匹配时客户端拒绝注册；改协议必须两端同步 +1（引用 shared 常量）。 */
  protocolVersion: PROTOCOL_VERSION,
  /** 浏览器 localStorage 的「玩家资料」存储键（昵称、头像编号、恢复令牌）。 */
  storageKey: 'draw-and-guess-profile-v1',
  /** 浏览器 localStorage 的「本地偏好设置」存储键（音量、快捷键、显示开关）。 */
  settingsStorageKey: 'draw-and-guess-settings-v1',
  /** sessionStorage 的「全屏提示已展示」记录键，避免同一会话反复弹全屏引导。 */
  fullscreenPromptSessionKey: 'draw-and-guess-fullscreen-prompt-v1',
} as const

export const network = {
  /** 客户端单次请求的 ack 等待上限（毫秒），超时按传输故障处理。 */
  requestTimeoutMs: 8_000,
  /** 普通幂等请求发生传输故障时的自动重试次数（复用同一 requestId）。 */
  requestRetryAttempts: 1,
  /** 自动重试前的等待时长（毫秒），留出 Socket.IO 快速重连的窗口。 */
  requestRetryDelayMs: 250,
  /** 非法或缺口推送触发全量重同步的最小间隔（毫秒），防止重同步风暴。 */
  stateResyncCooldownMs: 1_000,
  /** 传输已恢复但会话注册 ack 失败时的静默重试间隔（毫秒）。 */
  sessionRestoreRetryMs: 2_000,
  /** Socket.IO 心跳与延迟测量周期（毫秒）。 */
  pingIntervalMs: 10_000,
  /**
   * 网络按钮延迟档位阈值（毫秒，局域网语义）：
   * 测得往返延迟 ≤ latencyGoodMs 显示绿色（连接良好）；
   * 大于该值显示橙色（网络较慢）；断线时无论延迟为何值一律显示红色。
   * 阈值远大于局域网典型延迟（<10ms），留出抖动余量的同时能感知到明显的网络劣化。
   */
  latencyGoodMs: 80,
} as const
