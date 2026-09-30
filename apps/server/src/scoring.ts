/**
 * 回合计分与排名纯函数：猜中者得分明细、画家得分与最终排名冻结。
 * 独立成模块便于单元测试；同类规则必须保证 markCorrect 与 finishRound 用同口径。
 */
import { APP_CONFIG } from './config/index.ts'
import { calculateGuessScore, type FinalRankingEntry, type ScoreDetail } from '@draw-guess/shared'
import type { GameSecret, PlayerSecret, RoomSecret } from './models.ts'
import { activeGuessers, countActivePlayers, rankedMembers } from './domain/room/member-facts.ts'

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
}): number {
  const { game, room, drawerAbandoned } = input
  // 参与本回合的可玩成员全集（含已掉线者）：满员奖励按「每个人都确实猜中」判定。
  // 只认 guessedAt（猜中瞬间必然在线才置位）：猜中后掉线/离场不取消奖励，
  // 掉线但未猜中的成员仍会使奖励不成立；同一时刻离场成员（leftGame）不参与判定。
  const roundGuessers = activeGuessers(room, game.drawerId)
  const allCorrect = roundGuessers.length > 0 && roundGuessers.every((member) => member.guessedAt)
  return drawerAbandoned
    ? 0
    : game.correctOrder.length * APP_CONFIG.game.score.drawerPerCorrect +
        (allCorrect ? APP_CONFIG.game.score.drawerAllCorrectBonus : 0)
}

/**
 * 冻结最终排名（纯函数：不读时钟、不写状态，可脱离整局流程独立单测）。
 *
 * 排名必须在首次进入最终结算时一次性冻结：之后 leaveRoom 会从 room.members 移除成员，
 * 但已公布的成绩属于本局历史，不能跟随当前房间席位继续变化。
 * 成员口径走 member-facts 的 rankedMembers（排除观战、保留离局者）；
 * 资料取 leftProfile 优先、玩家身份兜底，两者皆无（身份被删除且未冻结）的成员不产出条目。
 * 名次按实际产出的条目数递增，而不是用被丢弃成员后的 index+1，避免「成员无资料被丢弃」时
 * 后续名次跳号（见 docs/adr/0002-final-ranking-no-gaps.md）；同分并列同名次。
 */
export function freezeFinalRanking(
  room: Pick<RoomSecret, 'members'>,
  players: ReadonlyMap<string, Pick<PlayerSecret, 'profile'>>,
): FinalRankingEntry[] {
  const ranked = rankedMembers(room).sort(
    (left, right) => right.score - left.score || left.joinedAt - right.joinedAt,
  )
  let previousScore: number | undefined
  let emittedCount = 0
  let rank = 0
  return ranked.flatMap<FinalRankingEntry>((member) => {
    const player = players.get(member.playerId)
    const profile = member.leftProfile ?? player?.profile
    if (!profile) return []
    emittedCount += 1
    if (member.score !== previousScore) rank = emittedCount
    previousScore = member.score
    return [
      {
        id: member.playerId,
        nickname: profile.nickname,
        avatarId: profile.avatarId,
        rank,
        score: member.score,
        stats: { ...member.stats },
      },
    ]
  })
}
