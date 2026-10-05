import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { createGameHarness, startTwoPlayerGame } from './helpers/game-harness.ts'

function enterGameResult() {
  const harness = createGameHarness()
  const state = startTwoPlayerGame(harness)
  harness.service.endEarly(state.host.playerId)
  return { harness, ...state }
}

describe('最终结算再来一局', () => {
  it('双客户端并发点击只记录一次意愿，并在最短展示期后单次转入等待', async () => {
    const { harness, host, guest, room } = enterGameResult()
    const resultVersion = room.stateVersion

    await Promise.all([
      Promise.resolve().then(() => harness.service.returnWaiting(guest.playerId)),
      Promise.resolve().then(() => harness.service.returnWaiting(host.playerId)),
      Promise.resolve().then(() => harness.service.returnWaiting(guest.playerId)),
    ])

    expect(room.phase).toBe('game_result')
    expect(room.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: host.playerId, rematchReady: true }),
        expect.objectContaining({ playerId: guest.playerId, rematchReady: true }),
      ]),
    )
    expect(room.stateVersion).toBe(resultVersion + 2)

    harness.runtime.advance(APP_CONFIG.game.gameResultMinSeconds * 1_000)
    expect(room.phase).toBe('waiting')
    expect(room.game).toBeUndefined()
    expect(room.members.every((member) => !member.rematchReady && !member.ready)).toBe(true)
    const waitingVersion = room.stateVersion

    expect(() => harness.service.returnWaiting(host.playerId)).not.toThrow()
    expect(() => harness.service.returnWaiting(guest.playerId)).not.toThrow()
    expect(room.stateVersion).toBe(waitingVersion)
    expect(harness.runtime.pendingTimerCount()).toBe(0)
  })

  it('普通玩家不能全局提前返回，自动上限到点后服务端收敛', () => {
    const { harness, guest, room } = enterGameResult()

    harness.service.returnWaiting(guest.playerId)
    harness.runtime.advance(APP_CONFIG.game.gameResultMinSeconds * 1_000)

    expect(room.phase).toBe('game_result')
    expect(room.members.find((member) => member.playerId === guest.playerId)?.rematchReady).toBe(
      true,
    )
    const guestView = harness.service.snapshotter.snapshot(room, guest.playerId)
    expect(guestView.members.find((member) => member.id === guest.playerId)?.rematchReady).toBe(
      true,
    )
    expect(guestView.game).toMatchObject({ canReturnWaiting: false })
    expect(guestView.game?.gameResultMinEndsAt).toBeGreaterThan(guestView.game!.phaseStartedAt)

    const hostView = harness.service.snapshotter.snapshot(room, room.hostId)
    expect(hostView.game?.canReturnWaiting).toBe(true)

    harness.runtime.advance(
      (APP_CONFIG.game.gameResultAutoReturnSeconds - APP_CONFIG.game.gameResultMinSeconds) * 1_000,
    )
    expect(room.phase).toBe('waiting')
  })

  it('最终结算中房主断线后迁移，新房主可在最短展示期结束时全局返回', () => {
    const { harness, host, guest, room } = enterGameResult()

    harness.service.handleDisconnect(host.socket as never)
    // 最终结算中短宽限后房主迁移给在线成员，断线原房主席位保留在房间中（ADR-0059）
    harness.runtime.advance(APP_CONFIG.network.drawerReconnectGraceMs)
    expect(room.hostId).toBe(guest.playerId)
    expect(room.members.some((member) => member.playerId === host.playerId)).toBe(true)

    harness.service.returnWaiting(guest.playerId)
    harness.runtime.advance(APP_CONFIG.game.gameResultMinSeconds * 1_000)

    expect(room.phase).toBe('waiting')
    expect(room.hostId).toBe(guest.playerId)
    expect(harness.runtime.pendingTimerCount()).toBe(1)
  })
})
