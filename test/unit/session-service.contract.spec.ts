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
    expect(harness.service.playersByToken.size).toBe(0)
    expect(second.socket.data.playerId).toBeUndefined()
    expect(second.socket.data.requestCache).toEqual(new Map())
  })
})
