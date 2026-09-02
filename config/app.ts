/**
 * 领域配置：应用标识、网络与连接参数。
 * 归入根级 config/ 目录后由 config.ts 聚合，保持“唯一业务配置中心”不变。
 */
export const app = {
  name: '你画我猜',
  englishName: 'Draw and Guess',
  version: '2.2.0',
  protocolVersion: '5', // 新增离局状态与固定席位颜色，不匹配时拒绝注册
  storageKey: 'draw-and-guess-profile-v1', // localStorage 资料键
  settingsStorageKey: 'draw-and-guess-settings-v1', // localStorage 设置键
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
  guessEventsPerSecond: 5, // 猜词事件限频（滑动窗口）
  requestEventsPerSecond: 25, // 应用层请求限频（每连接每秒，防刷事件触发全量广播）
} as const
