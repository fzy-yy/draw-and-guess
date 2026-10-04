/**
 * 接龙链级结算与终局榜（纯函数，S13 / S24 / S33 / S77）。
 *
 * 为什么单独成模块：链的「票数 → 是否匹配 → 每人入账多少」必须只有一处算式——
 * 状态机入账、终局榜统计、测试真值三处若各算一遍，改阈值或改乘法时必然漂移。
 * 因此本条链的明细（`RelayChainVoteTally`）在结算瞬间算一次并冻结在链上，
 * 入账与展示都取这一份；本模块不读时钟、不写状态，可脱离整机流程独立穷举。
 *
 * 计分口径（S13 / S24）：赞同票**严格多于**反对票才算匹配成功，成功后该链的
 * 4 名参与者每人得「赞同票数 × `relay.scorePerAgreeVote`」；否则本链 0 分，且不做归一化。
 */
import { RELAY_STEP_COUNT, type RelayFinalRankingEntry } from '@draw-guess/shared'
import { APP_CONFIG } from '../../config/index.ts'
import type { PlayerSecret, RoomSecret } from '../../models.ts'
import type { RelayChainVote, RelayGameSecret } from './relay-models.ts'

/** 一条链的结算明细：入账与展示取同一份（S13）。 */
export interface RelayChainVoteTally {
  /** 赞同票数。 */
  agreeCount: number
  /** 反对票数（含倒计时结束时补的「未投」票）。 */
  disagreeCount: number
  /** 是否匹配成功（赞同 > 反对）。 */
  matched: boolean
  /** 匹配成功时该链 4 名参与者**每人**的入账分；失败为 0。 */
  pointsPerParticipant: number
}

/** 按票行（到达顺序 + 补票）结算一条链：票数只数选择，与投票者身份无关（S42）。 */
export function tallyChainVotes(votes: readonly RelayChainVote[]): RelayChainVoteTally {
  const agreeCount = votes.filter((vote) => vote.choice === 'agree').length
  const disagreeCount = votes.length - agreeCount
  const matched = agreeCount > disagreeCount
  return {
    agreeCount,
    disagreeCount,
    matched,
    pointsPerParticipant: matched ? agreeCount * APP_CONFIG.relay.scorePerAgreeVote : 0,
  }
}

/**
 * 一条链的 4 名参与者（在链数组中的下标）：链 j 的第 s 棒动手者是链 (j + s - 1) 的发起人（S9），
 * 因此参与者＝链 j 及其环状顺延 1/2/3 位的发起人。入账与「参与链数」统计共用这一处算式，
 * 不各自展开一遍环状顺延。
 */
export function relayParticipantIndices(chainCount: number, chainIndex: number): number[] {
  const origin = chainIndex - 1
  return Array.from({ length: RELAY_STEP_COUNT }, (_, offset) => (origin + offset) % chainCount)
}

/**
 * 冻结接龙终局榜（S33 / S77）：只有名次、分数与接龙口径统计。
 * 排序与并列规则与经典 `freezeFinalRanking` 同口径（分数降序、同分并列同名次、同分按入房先后），
 * 榜单口径为 `room.members` 全员：主动退出本局者以冻结资料保留在榜（S37），
 * 资料取 `leftProfile` 优先、玩家身份兜底，两者皆无的成员不产出条目（名次不跳号）。
 * `chainCount` / `agreeVotes` 从链数组与冻结的链明细读取——与入账同源，不事后重算票数。
 */
export function freezeRelayFinalRanking(
  room: Pick<RoomSecret, 'members'>,
  relay: RelayGameSecret,
  players: ReadonlyMap<string, Pick<PlayerSecret, 'profile'>>,
): RelayFinalRankingEntry[] {
  const chainCount = relay.chains.length
  /** 某玩家参与过的链：发起人下标落在该链的 4 名参与者里（S9）。 */
  const participatedChainIndices = (playerId: string): number[] => {
    const playerIndex = relay.chains.findIndex((chain) => chain.originPlayerId === playerId)
    // 不在本局链阵容中的成员（异常现场）没有任何接龙统计，而不是把他人链算到他头上
    if (playerIndex < 0) return []
    return relay.chains
      .map((_chain, index) => index + 1)
      .filter((chainIndex) => relayParticipantIndices(chainCount, chainIndex).includes(playerIndex))
  }

  const ranked = [...room.members].sort(
    (left, right) => right.score - left.score || left.joinedAt - right.joinedAt,
  )
  let previousScore: number | undefined
  let emittedCount = 0
  let rank = 0
  return ranked.flatMap<RelayFinalRankingEntry>((member) => {
    const profile = member.leftProfile ?? players.get(member.playerId)?.profile
    if (!profile) return []
    emittedCount += 1
    if (member.score !== previousScore) rank = emittedCount
    previousScore = member.score
    const chains = participatedChainIndices(member.playerId)
    return [
      {
        id: member.playerId,
        nickname: profile.nickname,
        avatarId: profile.avatarId,
        rank,
        score: member.score,
        chainCount: chains.length,
        // 未结算的链（房主提前结束）没有明细 → 计 0 张赞同票，与「按当前分数结算」一致（S38）
        agreeVotes: chains.reduce(
          (total, chainIndex) => total + (relay.chains[chainIndex - 1]?.result?.agreeCount ?? 0),
          0,
        ),
      },
    ]
  })
}
