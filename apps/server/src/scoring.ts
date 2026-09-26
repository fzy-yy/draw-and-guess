/**
 * 回合计分纯函数：猜中者得分明细与画家得分计算。
 * 独立成模块便于单元测试；同类规则必须保证 markCorrect 与 finishRound 用同口径。
 */
import { APP_CONFIG } from './config/index.ts'
import { calculateGuessScore, type ScoreDetail } from '@draw-guess/shared'
import type { GameSecret, MemberState, RoomSecret } from './models.ts'
import { activeGuessers, countActivePlayers } from './domain/room/member-facts.ts'

/** 为单个猜中者构造得分明细（与猜中时同规则、同口径）。 */
export function buildGuessDetail(input: {
  game: GameSecret
  room: RoomSecret
  playerId: string
  guessedAt: number
  orderIndex: number // 猜中顺序（从 1 开始）
  durationMs: number
}): ScoreDetail {
  const { game, room, playerId, guessedAt, orderIndex, durationMs } = input
  const detail = {
    playerId,
    ...calculateGuessScore({
      elapsedMs: guessedAt - game.phaseStartedAt,
      durationMs,
      correctOrder: orderIndex,
      playerCount: countActivePlayers(room),
      // 统一猜词基础分为房间规则可设项（计分方式已固定为标准）；
      // 词条权重来自词库元数据；以默认权重 5 为基准缩放基础分，避免字段只在 UI 透传。
      base: Math.max(
        1,
        Math.round(
          (room.settings.guessBaseScore *
            (game.answer?.scoreWeight ?? APP_CONFIG.game.score.defaultWordWeight)) /
            APP_CONFIG.game.score.defaultWordWeight,
        ),
      ),
      maxSpeedBonus: APP_CONFIG.game.score.maxSpeedBonus,
      orderBonuses: APP_CONFIG.game.score.orderBonuses,
    }),
  }
  return detail
}

/** 计算画家本回合得分：每个猜中者计一件，全员猜中另有满员奖励；画家弃权得 0。 */
export function buildDrawerScore(input: {
  game: GameSecret
  room: RoomSecret
  drawerAbandoned: boolean
}): { score: number; allCorrect: boolean; roundGuessers: MemberState[] } {
  const { game, room, drawerAbandoned } = input
  // 参与本回合的可玩成员全集（含已掉线者）：满员奖励按「每个人都确实猜中」判定。
  // 只认 guessedAt（猜中瞬间必然在线才置位）：猜中后掉线/离场不取消奖励，
  // 掉线但未猜中的成员仍会使奖励不成立；同一时刻离场成员（leftGame）不参与判定。
  const roundGuessers = activeGuessers(room, game.drawerId)
  const allCorrect = roundGuessers.length > 0 && roundGuessers.every((member) => member.guessedAt)
  const score = drawerAbandoned
    ? 0
    : game.correctOrder.length * APP_CONFIG.game.score.drawerPerCorrect +
      (allCorrect ? APP_CONFIG.game.score.drawerAllCorrectBonus : 0)
  return { score, allCorrect, roundGuessers }
}
