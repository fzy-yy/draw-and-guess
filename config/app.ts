/**
 * 领域配置：应用标识、网络与连接参数。
 * 归入根级 config/ 目录后由 config.ts 聚合，保持“唯一业务配置中心”不变。
 */
export const app = {
  name: '你画我猜',
  version: '2.3.0',
  protocolVersion: '7', // 词库改为 SQLite 并改用单分类作为猜词提示（VocabularyWord 字段变更），不匹配时拒绝注册
  storageKey: 'draw-and-guess-profile-v1', // localStorage 资料键
  settingsStorageKey: 'draw-and-guess-settings-v1', // localStorage 设置键
  fullscreenPromptSessionKey: 'draw-and-guess-fullscreen-prompt-v1', // sessionStorage 全屏提示记录键
} as const

export const network = {
  host: '0.0.0.0', // 监听所有网卡，供局域网访问
  port: 5174,
  requestTimeoutMs: 8_000, // 客户端请求超时
  reconnectGraceMs: 120_000, // 从实际断线时刻起计算的身份/作画席位恢复宽限期
  sessionRestoreRetryMs: 2_000, // 传输已恢复但会话注册 ack 失败时的静默重试间隔
  drawerReconnectGraceMs: 20_000, // 作画阶段画家/房主的额外处置宽限期
  inviteExpiryMs: 30_000, // 邀请 30 秒有效
  inviteCooldownMs: 5_000, // 同一目标邀请冷却
  pingIntervalMs: 10_000, // Socket.IO 心跳与延迟测量周期
  /**
   * 网络按钮延迟档位阈值（毫秒，局域网语义）：
   * 测得往返延迟 ≤ latencyGoodMs 显示绿色（连接良好）；
   * 大于该值显示橙色（网络较慢）；断线时无论延迟为何值一律显示红色。
   * 阈值远大于局域网典型延迟（<10ms），留出抖动余量的同时能感知到明显的网络劣化。
   */
  latencyGoodMs: 80,
  guessEventsPerSecond: 5, // 猜词事件限频（滑动窗口）
  requestEventsPerSecond: 25, // 应用层请求限频（每连接每秒，防刷事件触发全量广播）
  /** 请求限频滑动窗口长度（毫秒）：binder 统计该窗口内的请求数与 requestEventsPerSecond 比较。 */
  requestRateWindowMs: 1_000,
  /** 幂等缓存条数上限（FIFO 淘汰）：防止长连接下 session:register 等成功结果无限累积。 */
  idempotencyCacheMax: 100,
} as const
