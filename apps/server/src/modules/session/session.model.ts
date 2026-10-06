/**
 * 会话与玩家身份领域模型。
 *
 * 包含玩家可存档持久化模型与内存秘密模型（PlayerSecret）。
 * 遵循《后端架构规范》R4.5h：明确区分数据库行结构与领域对象。
 */
export type { PlayerSecret } from '../../models.ts'

/**
 * 玩家可持久化行记录（对应 SQLite players 表）。
 */
export interface PlayerRecord {
  /** 玩家全局唯一 UUID */
  id: string
  /** 恢复令牌的 SHA-256 摘要（明文绝不落盘） */
  tokenDigest: string
  /** 玩家当前昵称 */
  nickname: string
  /** 内置 SVG 头像编号 */
  avatarId: string
  /** 是否允许在大厅中被其他玩家发现 */
  discoverable: boolean
  /** 是否接受其他玩家发起的定向对局邀请 */
  acceptsInvites: boolean
  /** 当前连接状态（在线为 true，掉线宽限期内为 false） */
  connected: boolean
  /** 首次注册入库的毫秒时间戳 */
  joinedAt: number
  /** 最近一次断线时间（用于计算断线宽限期超时） */
  disconnectedAt?: number
}
