/**
 * 领域配置：应用标识、网络与连接参数。
 * 归入根级 config/ 目录后由 config.ts 聚合，保持“唯一业务配置中心”不变。
 */
export const app = {
  name: '你画我猜',
  englishName: 'Draw and Guess',
  version: '2.2.0',
  protocolVersion: '4', // 头像预设与私密房间协议，不匹配时拒绝注册
  storageKey: 'draw-and-guess-profile-v1', // localStorage 资料键
  settingsStorageKey: 'draw-and-guess-settings-v1', // localStorage 设置键
} as const

export const network = {
  host: '0.0.0.0', // 监听所有网卡，供局域网访问
  port: 5174,
  requestTimeoutMs: 8_000, // 客户端请求超时
  reconnectGraceMs: 120_000, // 断线恢复宽限期（玩家级）
  drawerReconnectGraceMs: 20_000, // 画家/房主断线宽限期
  inviteExpiryMs: 30_000, // 邀请 30 秒有效
  inviteCooldownMs: 5_000, // 同一目标邀请冷却
  pingIntervalMs: 10_000, // Socket.IO 心跳与延迟测量周期
  guessEventsPerSecond: 5, // 猜词事件限频（滑动窗口）
  requestEventsPerSecond: 25, // 应用层请求限频（每连接每秒，防刷事件触发全量广播）
} as const
