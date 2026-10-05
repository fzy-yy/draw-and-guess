/**
 * 回合计分与排名纯函数：猜中者得分明细、画家得分与最终排名冻结。
 * 独立成模块便于单元测试；同类规则必须保证 markCorrect 与 finishRound 用同口径。
 */
import { APP_CONFIG } from './config/index.ts'
import { guessScoreForOrder, type FinalRankingEntry, type ScoreDetail } from '@draw-guess/shared'
import type { GameSecret, MemberState, PlayerSecret, RoomSecret } from './models.ts'

/**
 * 为单个猜中者构造得分明细：得分只由本回合猜中顺序决定。
 * 明细在猜中当时生成并入账，结算时直接取用（不事后重算，见 GameSecret.correctDetails 说明）。
 */
export function buildGuessDetail(input: {
  playerId: string
  orderIndex: number // 猜中顺序（从 1 开始）
}): ScoreDetail {
  const { playerId, orderIndex } = input
  return {
    playerId,
    order: orderIndex,
    total: guessScoreForOrder(orderIndex, APP_CONFIG.game.score.orderScores),
  }
}

/**
 * 计算画家本回合得分：每个猜中者 20 分，单回合上限 100（与「满分 100」的玩法口径一致）；
 * 画家弃权得 0。全员猜中不再有额外奖励——5 名猜中者恰好顶到上限。
 */
export function buildDrawerScore(input: { game: GameSecret; drawerAbandoned: boolean }): number {
  const { game, drawerAbandoned } = input
  if (drawerAbandoned) return 0
  return Math.min(
    APP_CONFIG.game.score.drawerMaxScore,
    game.correctOrder.length * APP_CONFIG.game.score.drawerPerCorrect,
  )
}

/** 一位入榜成员及其冻结名次：由 `rankMembers` 产出，两种终局榜（经典 / 接龙）共用同一份名次口径。 */
export interface RankedMember {
  member: MemberState
  /** 该成员的冻结资料（leftProfile 优先、玩家身份兜底）。 */
  profile: PlayerSecret['profile']
  /** 名次（1 起；同分并列同名次，不跳号）。 */
  rank: number
}

/**
 * 冻结名次行（纯函数：不读时钟、不写状态）：两种终局榜的**唯一**排序与并列口径
 *（见 docs/adr/0002-final-ranking-no-gaps.md）。
 *
 * 排名必须在首次进入最终结算时一次性冻结：之后 leaveRoom 会从 room.members 移除成员，
 * 但已公布的成绩属于本局历史，不能跟随当前房间席位继续变化。
 * 榜单口径为 room.members 全员：主动退出本局者以冻结成绩卡保留在榜（离局占位由 leftProfile 供资料），
 * 资料取 leftProfile 优先、玩家身份兜底，两者皆无（身份被删除且未冻结）的成员不产出条目。
 * 名次按实际产出的条目数递增，而不是用被丢弃成员后的 index+1，避免「成员无资料被丢弃」时
 * 后续名次跳号；同分并列同名次，同分按入房先后。
 * 经典榜与接龙榜各自只负责把本行的成员映射成自己的条目形状，绝不重写这段排序 / 并列逻辑。
 */
export function rankMembers(
  room: Pick<RoomSecret, 'members'>,
  players: ReadonlyMap<string, Pick<PlayerSecret, 'profile'>>,
): RankedMember[] {
  const ranked = [...room.members].sort(
    (left, right) => right.score - left.score || left.joinedAt - right.joinedAt,
  )
  let previousScore: number | undefined
  let emittedCount = 0
  let rank = 0
  return ranked.flatMap<RankedMember>((member) => {
    const profile = member.leftProfile ?? players.get(member.playerId)?.profile
    if (!profile) return []
    emittedCount += 1
    if (member.score !== previousScore) rank = emittedCount
    previousScore = member.score
    return [{ member, profile, rank }]
  })
}

/** 冻结最终排名：经典口径（分数 + 本局统计），名次与并列规则全取 `rankMembers`。 */
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
