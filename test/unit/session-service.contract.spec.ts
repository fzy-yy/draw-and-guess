import { describe, expect, it, vi } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { ERROR_CODES, EVENTS } from '@draw-guess/shared'
import { serverErrorMessages } from '@draw-guess/strings'
import { SessionService } from '../../apps/server/src/domain/session/session-service.ts'
import { bindRequest } from '../../apps/server/src/protocol/binder.ts'
import type { RuntimeLogger } from '../../apps/server/src/errors.ts'
import { digestRecoveryToken } from '../../apps/server/src/security/recovery-token.ts'
import { createGameHarness, testRoomSettings } from './helpers/game-harness.ts'

/** 记录型日志器：断言失败路径确实落了白名单日志，且日志里没有明文恢复令牌。 */
function createRecordingLogger(): RuntimeLogger & {
  errors: Array<{ context: Record<string, unknown>; message: string }>
} {
  const errors: Array<{ context: Record<string, unknown>; message: string }> = []
  const logger = {
    errors,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (context: Record<string, unknown>, message: string) => {
      errors.push({ context, message })
    },
  }
  return logger as unknown as RuntimeLogger & { errors: typeof errors }
}

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

  it('协议版本错配在注册入口拒绝：不落库、不绑定连接，可凭正确版本重试', () => {
    const harness = createGameHarness()
    const socket = harness.createSocket('protocol-mismatch')
    const upsert = vi.spyOn(harness.repositories.players, 'upsert')
    expect(() =>
      harness.service.session.register(socket as never, {
        protocolVersion: 'stale-version',
        profile: { nickname: '旧客户端', avatarId: '01' },
        preferences: { discoverable: true, acceptsInvites: true },
      }),
    ).toThrow(serverErrorMessages[ERROR_CODES.PROTOCOL_MISMATCH])
    expect(harness.service.players.size).toBe(0)
    expect(socket.data.playerId).toBeUndefined()
    expect(upsert).not.toHaveBeenCalled()

    // 同一连接改用受支持的协议版本仍可正常注册，不被上一条失败污染。
    const identity = harness.service.session.register(socket as never, {
      protocolVersion: APP_CONFIG.app.protocolVersion,
      profile: { nickname: '新客户端', avatarId: '01' },
      preferences: { discoverable: true, acceptsInvites: true },
    })
    expect(identity.player.id).toBeTruthy()
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

  it('持久化删除失败时注销不生效：内存身份与连接仍有效，旧令牌不会出现分裂状态', () => {
    const logger = createRecordingLogger()
    const harness = createGameHarness({ logger })
    const player = harness.register('原子注销', 'logout-socket')
    const room = harness.service.createRoom(player.playerId, {
      name: '注销房',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    const remove = vi.spyOn(harness.repositories.players, 'remove').mockImplementationOnce(() => {
      throw new Error('database is locked')
    })

    expect(() => harness.service.session.logout(player.socket as never)).toThrow(
      serverErrorMessages[ERROR_CODES.INTERNAL_ERROR],
    )
    expect(remove).toHaveBeenCalledTimes(1)

    // 内存身份、令牌索引与当前连接必须原样保留：注销整体不生效，而不是半途而废。
    const live = harness.service.requirePlayer(player.playerId)
    expect(live.connected).toBe(true)
    expect(live.socketId).toBe('logout-socket')
    expect(live.roomId).toBe(room.id)
    expect(
      harness.service.playersByTokenDigest.get(digestRecoveryToken(player.recoveryToken)),
    ).toBe(live)
    expect(player.socket.data.playerId).toBe(player.playerId)
    expect(player.socket.rooms.has(room.id)).toBe(true)

    // 持久化记录也还在：两层一致（要么都有效，要么都失效），不存在「库内有效但内存已删」。
    expect(harness.repositories.players.has(player.playerId)).toBe(true)
    expect(
      harness.repositories.players.findByTokenDigest(digestRecoveryToken(player.recoveryToken)),
    ).toBeDefined()

    // 白名单日志：只记错误类型与玩家 ID，绝不记录明文恢复令牌。
    expect(logger.errors).toHaveLength(1)
    expect(logger.errors[0]?.message).toBe('清理玩家持久化记录失败')
    expect(logger.errors[0]?.context).toEqual({ errorType: 'Error', playerId: player.playerId })
    expect(JSON.stringify(logger.errors)).not.toContain(player.recoveryToken)

    // 失败后重试成功：状态自愈，两层同时失效。
    expect(() => harness.service.session.logout(player.socket as never)).not.toThrow()
    expect(harness.service.players.size).toBe(0)
    expect(harness.service.playersByTokenDigest.size).toBe(0)
    expect(harness.repositories.players.has(player.playerId)).toBe(false)
  })

  it('持久化失败时注销 ack 是 INTERNAL_ERROR 而非成功，且失败不进入幂等缓存', async () => {
    const harness = createGameHarness()
    const player = harness.register('注销 ack', 'logout-ack')
    vi.spyOn(harness.repositories.players, 'remove').mockImplementationOnce(() => {
      throw new Error('database is locked')
    })
    let listener: ((raw: unknown, callback?: (ack: unknown) => void) => Promise<void>) | undefined
    const socket = {
      id: 'logout-ack',
      data: {
        playerId: player.playerId,
        requestCache: new Map(),
        inFlightRequests: new Map(),
        service: {
          clock: { now: () => 1_000 },
          metrics: {
            recordAcknowledgement: () => undefined,
            recordResync: () => undefined,
          },
          logUnexpectedError: () => undefined,
        },
      },
      on: (_event: string, callback: typeof listener) => (listener = callback),
    } as unknown as Parameters<typeof bindRequest>[0]
    bindRequest(
      socket,
      EVENTS.sessionLogout,
      () => {
        harness.service.logout(socket as never)
        return { success: true }
      },
      { registration: true },
    )
    if (!listener) throw new Error('未绑定监听器')
    const request = { requestId: '00000000-0000-4000-8000-000000000099' }
    const acks: Array<{ ok: boolean; error?: { code: string }; data?: unknown }> = []
    await listener(request, (ack) => acks.push(ack as never))

    expect(acks[0]).toMatchObject({ ok: false, error: { code: ERROR_CODES.INTERNAL_ERROR } })
    // 失败不缓存：同一 requestId 重试会真正重新执行（此时持久化已恢复）并成功。
    await listener(request, (ack) => acks.push(ack as never))
    expect(acks[1]).toMatchObject({ ok: true, data: { success: true } })
    expect(harness.repositories.players.has(player.playerId)).toBe(false)
    expect(harness.service.players.size).toBe(0)
  })

  it('重复注销幂等：第二次不再触发持久化删除，也不抛错', () => {
    const harness = createGameHarness()
    const player = harness.register('重复注销')
    const remove = vi.spyOn(harness.repositories.players, 'remove')

    harness.service.session.logout(player.socket as never)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(harness.repositories.players.has(player.playerId)).toBe(false)

    expect(() => harness.service.session.logout(player.socket as never)).not.toThrow()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(harness.service.players.size).toBe(0)
    expect(player.socket.data.playerId).toBeUndefined()
    expect(player.socket.data.requestCache).toEqual(new Map())
  })

  it('身份已不在内存时注销幂等成功，且不会去动持久化层', () => {
    const harness = createGameHarness()
    const player = harness.register('身份已过期')
    // 模拟恢复宽限到期：内存身份与令牌索引都已被移除（持久化行由启动清理兜底）。
    harness.service.players.delete(player.playerId)
    harness.service.playersByTokenDigest.delete(digestRecoveryToken(player.recoveryToken))
    const remove = vi.spyOn(harness.repositories.players, 'remove')

    expect(() => harness.service.session.logout(player.socket as never)).not.toThrow()
    expect(remove).not.toHaveBeenCalled()
    expect(player.socket.data.playerId).toBeUndefined()
    expect(player.socket.data.requestCache).toEqual(new Map())
  })

  it('离房失败只记录日志：持久化吊销与内存清理仍必须完成', () => {
    const logger = createRecordingLogger()
    const harness = createGameHarness({ logger })
    const player = harness.register('离房失败')
    harness.service.createRoom(player.playerId, {
      name: '离房失败房',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    const leaveRoom = vi
      .spyOn(harness.service.membership, 'leaveRoom')
      .mockImplementationOnce(() => {
        throw new Error('room state corrupted')
      })

    expect(() => harness.service.session.logout(player.socket as never)).not.toThrow()
    expect(leaveRoom).toHaveBeenCalledTimes(1)
    expect(logger.errors.map((entry) => entry.message)).toEqual(['玩家注销离房失败'])
    expect(JSON.stringify(logger.errors)).not.toContain(player.recoveryToken)
    expect(harness.repositories.players.has(player.playerId)).toBe(false)
    expect(harness.service.players.size).toBe(0)
    expect(player.socket.data.playerId).toBeUndefined()
  })

  it('被接管的旧连接迟到注销不会删除新会话：只解绑自己', () => {
    const harness = createGameHarness()
    const first = harness.register('接管前', 'socket-old')
    const second = harness.register('接管后', 'socket-new', first.recoveryToken)
    expect(second.playerId).toBe(first.playerId)
    const remove = vi.spyOn(harness.repositories.players, 'remove')

    harness.service.session.logout(first.socket as never)

    const live = harness.service.requirePlayer(second.playerId)
    expect(live.connected).toBe(true)
    expect(live.socketId).toBe('socket-new')
    expect(live.tokenDigest).toBe(digestRecoveryToken(second.recoveryToken))
    expect(harness.service.playersByTokenDigest.get(live.tokenDigest)).toBe(live)
    expect(harness.repositories.players.has(second.playerId)).toBe(true)
    expect(remove).not.toHaveBeenCalled()
    expect(first.socket.data.playerId).toBeUndefined()
    // 新连接仍可正常注销自己的身份。
    harness.service.session.logout(second.socket as never)
    expect(harness.service.players.size).toBe(0)
    expect(harness.repositories.players.has(second.playerId)).toBe(false)
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
