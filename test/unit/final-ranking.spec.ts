import { describe, expect, it } from 'vitest'
import { createGameHarness, startTwoPlayerGame } from './helpers/game-harness.ts'

/**
 * 最终榜单的成员口径回归：`round-machine.finishGame` 用 `rankedMembers`（内部即 `isRankedMember`，
 * 仅排除观战）而**保留离局者**。
 * 该行为此前无测试固定（既有用例只证明「候场观战者被排除」），一旦有人把口径改成「排除离局」，
 * 离局者的成绩卡会从结算榜消失。见 docs/adr/0023-member-facts-single-source.md。
 */
describe('最终榜单成员口径', () => {
  it('离局但非观战的成员仍进入最终榜单（成绩卡属于本局历史）', () => {
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
