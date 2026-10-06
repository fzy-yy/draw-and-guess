/**
 * 战报归档领域模型与数据行契约。
 *
 * 遵循架构约定：
 * 战报仅在对局全部结束（finishGame）时落盘低频关键态，
 * 包含最终结算排名与逐位玩家分数、头像、昵称镜像快照。
 */
import type { GameMode } from '@draw-guess/shared'

/**
 * 单局战报归档记录（与 game_archive 表对应）。
 */
export interface GameArchiveRecord {
  /** 对局唯一标识 UUID */
  id: string
  /** 发生对局的房间 ID */
  roomId: string
  /** 对局开始毫秒时间戳 */
  startedAt: number
  /** 对局结束毫秒时间戳 */
  finishedAt: number
  /** 本局总轮数/回合数 */
  totalRounds: number
  /** 序列化后的最终排名 JSON 文本 */
  finalRanking: string
  /** 结束原因（完成所有轮次、房主提前结束、人数不足等） */
  reason?: string
  /** 玩法模式（classic 经典模式 / relay 接龙模式） */
  mode: GameMode
}

/**
 * 逐位玩家战报明细记录（与 game_results 表对应）。
 */
export interface GameResultRecord {
  /** 关联的对局 UUID */
  gameId: string
  /** 玩家 UUID */
  playerId: string
  /** 结算时冻结的玩家昵称 */
  nickname: string
  /** 结算时冻结的玩家头像编号 */
  avatarId: string
  /** 最终名次（并列名次同号） */
  rank: number
  /** 本局最终总得分 */
  score: number
  /** 扩展统计信息（JSON 文本，如猜中数、赞同票数等） */
  stats: string
}
