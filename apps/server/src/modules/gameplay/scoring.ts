/**
 * 回合计分与排名纯函数：猜中者得分明细、画家得分与最终排名冻结。
 *
 * 遵循架构约定：
 * 1. 独立成纯函数模块，便于无副作用单测；
 * 2. 严格采用固定 100 分制（ADR-0047）；
 * 3. 终局排名在首次进入 game_result 时一次性冻结（ADR-0002 不跳号并列）。
 */
import { APP_CONFIG } from '../../core/config.ts'
import { guessScoreForOrder, type FinalRankingEntry, type ScoreDetail } from '@draw-guess/shared'
import type { GameSecret, MemberState, PlayerSecret, RoomSecret } from '../../models.ts'

/**
 * 为单个猜中者构造得分明细：得分只由本回合猜中顺序决定。
 */
export function buildGuessDetail(input: { playerId: string; orderIndex: number }): ScoreDetail {
  const { playerId, orderIndex } = input
  return {
    playerId,
    order: orderIndex,
    total: guessScoreForOrder(orderIndex, APP_CONFIG.game.score.orderScores),
  }
}

/**
 * 计算画家本回合得分：每个猜中者 20 分，单回合上限 100。
 */
export function buildDrawerScore(input: { game: GameSecret; drawerAbandoned: boolean }): number {
  const { game, drawerAbandoned } = input
  if (drawerAbandoned) return 0
  return Math.min(
    APP_CONFIG.game.score.drawerMaxScore,
    game.correctOrder.length * APP_CONFIG.game.score.drawerPerCorrect,
  )
}

/** 一位入榜成员及其冻结名次 */
export interface RankedMember {
  member: MemberState
  profile: PlayerSecret['profile']
  rank: number
}

/**
 * 冻结名次行（纯函数）：两种终局榜（经典 / 接龙）的唯一排序与并列口径。
 */
export function rankMembers(
  room: Pick<RoomSecret, 'members'>,
  players: ReadonlyMap<string, Pick<PlayerSecret, 'profile'>>,
): RankedMember[] {
  const ranked = [...room.members].sort(
    (left, right) => right.score - left.score || left.joinedAt - right.joinedAt,
  )

  const items: RankedMember[] = []
  let currentRank = 1
  let previousScore: number | undefined

  for (const member of ranked) {
    const profile = member.leftProfile ?? players.get(member.playerId)?.profile
    if (!profile) continue

    if (previousScore !== undefined && member.score !== previousScore) {
      currentRank = items.length + 1
    }
    previousScore = member.score

    items.push({
      member,
      profile,
      rank: currentRank,
    })
  }

  return items
}

/**
 * 冻结经典模式最终排名：把全员入榜结果映射为协议 FinalRankingEntry[]。
 *
 * 只输出协议 `FinalRankingEntrySchema` 声明的字段：客户端对快照做严格解码，
 * 多写一个未声明字段会让**整份终局快照被丢弃**（房主已提前结束，客户端却停在对局页）。
 * 「谁已离局」由房间成员视图的 `leftGame` 表达，终局榜不需要也不该重复它。
 */
export function freezeFinalRanking(
  room: Pick<RoomSecret, 'members'>,
  players: ReadonlyMap<string, Pick<PlayerSecret, 'profile'>>,
): FinalRankingEntry[] {
  return rankMembers(room, players).map(({ member, profile, rank }) => ({
    id: member.playerId,
    nickname: profile.nickname,
    avatarId: profile.avatarId,
    rank,
    score: member.score,
    stats: { ...member.stats },
  }))
}
