import { describe, expect, it } from 'vitest'
import { createGameHarness, startTwoPlayerGame } from './helpers/game-harness.ts'
import { freezeFinalRanking } from '../../apps/server/src/scoring.ts'
import type { MemberState, PlayerSecret } from '../../apps/server/src/models.ts'

/**
 * 最终榜单的成员口径回归：`round-machine.finishGame` 冻结 room.members 全员
 *（离局者以冻结成绩卡保留在榜，实现在 scoring.freezeFinalRanking）。
 * 该行为此前无测试固定（既有用例只证明「候场观战者被排除」），一旦有人把口径改成「排除离局」，
 * 离局者的成绩卡会从结算榜消失。见 docs/adr/0023-member-facts-single-source.md。
 */
describe('最终榜单成员口径', () => {
  it('离局成员仍进入最终榜单（成绩卡属于本局历史）', () => {
    const harness = createGameHarness()
    const { host, guest, room } = startTwoPlayerGame(harness)

    // 客人中途退出本局：真实路径保留离局占位并冻结其公开资料（leftProfile）
    harness.service.leaveGame(guest.playerId)
    // 在线可玩不足 2 人会自动暂停，此时房主仍可提前结束并进入最终结算
    expect(room.phase).toBe('paused')
    expect(room.members.find((member) => member.playerId === guest.playerId)?.leftGame).toBe(true)

    harness.service.endEarly(host.playerId)
    const view = harness.service.snapshotter.snapshot(room, host.playerId)
    expect(view.game?.finalRanking?.map((entry) => entry.id)).toContain(guest.playerId)
  })
})

/** 直接单测用的最小成员：只填排名冻结会读取的字段。 */
function makeMember(
  playerId: string,
  score: number,
  patch: Partial<MemberState> = {},
): MemberState {
  return {
    playerId,
    seatIndex: 0,
    ready: true,
    score,
    joinedAt: 1_700_000_000_000,
    stats: { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 },
    ...patch,
  }
}

/** 直接单测用的最小玩家册：只暴露资料字段。 */
function makePlayers(entries: Array<[string, string]>): Map<string, Pick<PlayerSecret, 'profile'>> {
  const players = new Map<string, Pick<PlayerSecret, 'profile'>>()
  for (const [playerId, nickname] of entries)
    players.set(playerId, { profile: { nickname, avatarId: '01' } })
  return players
}

/**
 * freezeFinalRanking 的直接用例：把排名冻结从整局流程中剥离后，
 * 「无资料成员被丢弃且名次不跳号」「同分并列同名次」这两条规则可以不经对局 harness 固定下来
 *（见 docs/adr/0002-final-ranking-no-gaps.md）。
 */
describe('freezeFinalRanking 直接用例', () => {
  it('无资料成员被丢弃，但后续名次按实际产出条目递增，不跳号', () => {
    const room = {
      members: [
        makeMember('a', 100, { joinedAt: 1 }),
        makeMember('b', 90, { joinedAt: 2 }), // 玩家册与 leftProfile 皆无资料 → 丢弃
        makeMember('c', 80, { joinedAt: 3 }),
      ],
    }
    const ranking = freezeFinalRanking(
      room,
      makePlayers([
        ['a', '甲'],
        ['c', '丙'],
      ]),
    )

    expect(ranking.map((entry) => [entry.id, entry.rank])).toEqual([
      ['a', 1],
      ['c', 2], // 旧实现用 index+1 会得到 3
    ])
  })

  it('同分并列同名次，后一名次按产出条目数递增；离局者用冻结的 leftProfile', () => {
    const room = {
      members: [
        makeMember('a', 100, { joinedAt: 1 }),
        makeMember('b', 100, { joinedAt: 2 }),
        makeMember('c', 50, {
          joinedAt: 3,
          leftGame: true,
          leftProfile: { nickname: '已离局', avatarId: '02' },
        }),
      ],
    }
    const ranking = freezeFinalRanking(
      room,
      makePlayers([
        ['a', '甲'],
        ['b', '乙'],
      ]),
    )

    expect(ranking.map((entry) => [entry.id, entry.rank])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
    ])
    expect(ranking[2]?.nickname).toBe('已离局')
  })
})
