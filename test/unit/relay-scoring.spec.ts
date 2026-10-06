/**
 * 接龙链计分（工单 08；S13 / S24 / S33 / S77）。
 *
 * 两层断言：
 * - 纯函数层：阈值（赞同 **严格多于** 反对）、每张赞同票 × `relay.scorePerAgreeVote`、
 *   失败链 0 分、链的 4 名参与者环状顺延（S9）；
 * - 整机层：把一局按手算的投票方案走完，逐名玩家的分数与终局榜统计与**独立手算真值**逐项比对
 *   （入账与结算展示同源：分数 = Σ 所在链明细的 `pointsPerParticipant`）。
 */
import { describe, expect, it } from 'vitest'
import type { RelayVoteChoice } from '@draw-guess/shared'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import type { RelayChainVote } from '../../apps/server/src/domain/relay/relay-models.ts'
import {
  relayParticipantIndices,
  tallyChainVotes,
} from '../../apps/server/src/domain/relay/relay-voting.ts'
import { startRelayGame } from './helpers/relay-game-fixture.ts'

/** 按到达顺序造一条票行：`agree` 张赞同 + `disagree` 张不赞同（投票者身份与结算无关）。 */
function votes(agree: number, disagree: number): RelayChainVote[] {
  return [
    ...Array.from({ length: agree }, (_, index) => ({
      playerId: `agree-${index}`,
      choice: 'agree' as const,
    })),
    ...Array.from({ length: disagree }, (_, index) => ({
      playerId: `disagree-${index}`,
      choice: 'disagree' as const,
    })),
  ]
}

describe('接龙链计分纯函数（S13 / S24）', () => {
  it('严格多数才算匹配成功：赞同 = 反对 判失败（阈值不放宽）', () => {
    expect(tallyChainVotes(votes(2, 2))).toEqual({
      agreeCount: 2,
      disagreeCount: 2,
      matched: false,
      pointsPerParticipant: 0,
    })
    expect(tallyChainVotes(votes(2, 3)).matched).toBe(false)
    expect(tallyChainVotes(votes(0, 4)).matched).toBe(false)
    // 零票（全员未投 → 已被补成不赞同，这里覆盖空数组的纯函数边界）
    expect(tallyChainVotes([])).toEqual({
      agreeCount: 0,
      disagreeCount: 0,
      matched: false,
      pointsPerParticipant: 0,
    })
  })

  it('匹配成功时每人得「赞同票数 × scorePerAgreeVote」：倍数只数赞同票', () => {
    const perVote = APP_CONFIG.relay.scorePerAgreeVote
    expect(perVote).toBe(10)
    expect(tallyChainVotes(votes(3, 1))).toEqual({
      agreeCount: 3,
      disagreeCount: 1,
      matched: true,
      pointsPerParticipant: 3 * perVote,
    })
    // 反对票再多也不进倍数：只有赞同票决定入账
    expect(tallyChainVotes(votes(4, 2)).pointsPerParticipant).toBe(4 * perVote)
    expect(tallyChainVotes(votes(1, 0)).pointsPerParticipant).toBe(perVote)
  })

  it('链的 4 名参与者＝发起人 + 环状顺延 1/2/3 位（S9），每人固定参与 4 条链（S24）', () => {
    // 手算样例：4 人局每条链都是全员；5 人局第 2 条链是第 2/3/4/5 人
    expect(relayParticipantIndices(4, 1)).toEqual([0, 1, 2, 3])
    expect(relayParticipantIndices(5, 2)).toEqual([1, 2, 3, 4])
    // 6 人局最后一条链跨过环尾：第 6/1/2/3 人
    expect(relayParticipantIndices(6, 6)).toEqual([5, 0, 1, 2])

    // 不归一化（S24）：无论几人局，每人参与的链数恒为 4
    for (const chainCount of [4, 5, 6]) {
      for (let playerIndex = 0; playerIndex < chainCount; playerIndex += 1) {
        const participated = Array.from({ length: chainCount }, (_, chain) => chain + 1).filter(
          (chainIndex) => relayParticipantIndices(chainCount, chainIndex).includes(playerIndex),
        )
        expect(participated, `${chainCount} 人局第 ${playerIndex + 1} 人`).toHaveLength(4)
      }
    }
  })
})

describe('接龙整局计分（手算真值）', () => {
  it('按票计分与终局榜统计逐项对上独立手算的期望值（S13 / S33 / S77）', () => {
    const scenario = startRelayGame({ playerCount: 4 })
    // 手算的投票方案（按席位）：第 1 条 4:0、第 2 条 3:1、第 3 条 2:2、第 4 条 0:4
    const plan: Record<number, RelayVoteChoice[]> = {
      1: ['agree', 'agree', 'agree', 'agree'],
      2: ['agree', 'agree', 'agree', 'disagree'],
      3: ['agree', 'agree', 'disagree', 'disagree'],
      4: ['disagree', 'disagree', 'disagree', 'disagree'],
    }
    const perVote = APP_CONFIG.relay.scorePerAgreeVote

    scenario.playToResult((chainIndex, player) => {
      const seat = scenario.players.indexOf(player)
      return plan[chainIndex]?.[seat] ?? 'disagree'
    })

    expect(scenario.room.phase).toBe('game_result')
    // 期望分：第 1 条 4×10 + 第 2 条 3×10 = 70（第 3/4 条未匹配得 0）；4 人局全员参与全部链
    const expectedScore = 4 * perVote + 3 * perVote
    expect(expectedScore).toBe(70)
    // 期望赞同票：本条链收到的赞同票合计（4+3+2+0），同样人人相同（每条链的参与者＝全员）
    const expectedAgreeVotes = 4 + 3 + 2 + 0

    for (const member of scenario.room.members) expect(member.score).toBe(expectedScore)
    const ranking = scenario.snapshotOf(scenario.host.playerId).relay?.finalRanking
    expect(ranking).toHaveLength(4)
    for (const entry of ranking ?? []) {
      // 同分并列同名次；统计口径与分数同源
      expect(entry).toMatchObject({
        rank: 1,
        score: expectedScore,
        chainCount: 4,
        agreeVotes: expectedAgreeVotes,
      })
    }
  })
})
