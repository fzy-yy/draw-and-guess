import { describe, expect, it, vi } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { SessionService } from '../../apps/server/src/domain/session/session-service.ts'
import { createGameHarness } from './helpers/game-harness.ts'

describe('SessionService 与 Facade 契约', () => {
  it('注册失败不提交内存身份或 Socket 绑定；可在同一连接重试', () => {
    const harness = createGameHarness()
    const socket = harness.createSocket('session-contract')
    const input = {
      protocolVersion: APP_CONFIG.app.protocolVersion,
      profile: { nickname: '会话玩家', avatarId: '01' as const },
      preferences: { discoverable: true, acceptsInvites: true },
    }
    const persist = vi.spyOn(harness.repositories.players, 'upsert')
    persist.mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })
    expect(harness.service.session).toBeInstanceOf(SessionService)
    expect(() => harness.service.session.register(socket as never, input)).toThrow(
      'storage unavailable',
    )
    expect(harness.service.players.size).toBe(0)
    expect(socket.data.playerId).toBeUndefined()
    const identity = harness.service.session.register(socket as never, input)
    expect(harness.service.register(socket as never, input).player.id).toBe(identity.player.id)
    expect(harness.service.players.size).toBe(1)
  })

  it('旧连接迟到断线不影响接管身份；注销同时清空索引与请求缓存', () => {
    const harness = createGameHarness()
    const first = harness.register('接管玩家', 'old')
    const second = harness.register('接管玩家', 'new', first.recoveryToken)
    harness.service.session.handleDisconnect(first.socket as never)
    expect(harness.service.requirePlayer(second.playerId).connected).toBe(true)
    harness.service.session.logout(second.socket as never)
    expect(harness.service.players.size).toBe(0)
    expect(harness.service.playersByTokenDigest.size).toBe(0)
    expect(second.socket.data.playerId).toBeUndefined()
    expect(second.socket.data.requestCache).toEqual(new Map())
  })

  it('并发恢复只有一个请求能接管原身份，且每次成功后旧令牌立即失效', async () => {
    const original = createGameHarness()
    const player = original.register('并发恢复')
    original.service.handleDisconnect(player.socket as never)

    const first = createGameHarness({
      runtime: original.runtime,
      repositories: original.repositories,
    })
    const second = createGameHarness({
      runtime: original.runtime,
      repositories: original.repositories,
    })
    const [firstResult, secondResult] = await Promise.all([
      Promise.resolve().then(() =>
        first.register('首次竞争', 'recovery-first', player.recoveryToken),
      ),
      Promise.resolve().then(() =>
        second.register('第二次竞争', 'recovery-second', player.recoveryToken),
      ),
    ])

    const winners = [firstResult, secondResult].filter(
      (result) => result.playerId === player.playerId,
    )
    expect(winners).toHaveLength(1)
    expect(winners[0]?.recoveryToken).not.toBe(player.recoveryToken)

    const retry = createGameHarness({
      runtime: original.runtime,
      repositories: original.repositories,
    }).register('旧令牌重试', 'recovery-retry', player.recoveryToken)
    expect(retry.playerId).not.toBe(player.playerId)

    const winnerHarness = firstResult.playerId === player.playerId ? first : second
    const rotatedAgain = winnerHarness.register(
      '再次恢复',
      'recovery-rotated',
      winners[0]!.recoveryToken,
    )
    expect(rotatedAgain.playerId).toBe(player.playerId)
    expect(rotatedAgain.recoveryToken).not.toBe(winners[0]!.recoveryToken)
  })
})
