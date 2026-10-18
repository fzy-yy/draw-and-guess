import { describe, expect, it, vi } from 'vitest'
import { RoomPersistenceCoordinator } from '../../apps/server/src/application/room-persistence-coordinator.ts'
import { createGameHarness, startTwoPlayerGame } from './helpers/game-harness.ts'

describe('RoomPersistenceCoordinator 映射契约', () => {
  it('玩家映射只传短期身份字段，不泄漏运行期房间归属', () => {
    const harness = createGameHarness()
    const { host } = startTwoPlayerGame(harness)
    const upsert = vi.fn()
    const coordinator = new RoomPersistenceCoordinator({
      clock: harness.runtime.clock,
      repositories: {
        players: { upsert },
        archive: { saveGame: vi.fn() },
      },
    })
    coordinator.persistPlayer(harness.backend.requirePlayer(host.playerId))
    expect(Object.keys(upsert.mock.calls[0]![0]).sort()).toEqual(
      [
        'acceptsInvites',
        'avatarId',
        'connected',
        'disconnectedAt',
        'discoverable',
        'id',
        'joinedAt',
        'nickname',
        'tokenDigest',
      ].sort(),
    )
    expect(upsert.mock.calls[0]![0]).not.toHaveProperty('roomId')
    expect(upsert.mock.calls[0]![0]).not.toHaveProperty('token')
    expect(upsert.mock.calls[0]![0]).toMatchObject({
      tokenDigest: harness.backend.requirePlayer(host.playerId).tokenDigest,
    })
  })

  it('战报只读取冻结榜单，未结算时不写入', () => {
    const harness = createGameHarness()
    const { host, room } = startTwoPlayerGame(harness)
    harness.backend.persistence.persistGameResult(room, '未结算')
    expect(harness.repositories.archive.games).toHaveLength(0)
    harness.backend.gameplay.endEarly(host.playerId)
    const snapshot = structuredClone(harness.repositories.archive.games[0])
    room.members.length = 0
    harness.backend.persistence.persistGameResult(room, '再次映射')
    expect(harness.repositories.archive.games[1]?.results).toEqual(snapshot?.results)
  })
})
