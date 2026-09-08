import { describe, expect, it, vi } from 'vitest'
import { RoomPersistenceCoordinator } from '../../apps/server/src/application/room-persistence-coordinator.ts'
import { createGameHarness, startTwoPlayerGame } from './helpers/game-harness.ts'

describe('RoomPersistenceCoordinator 映射契约', () => {
  it('玩家与房间映射只传低频字段，成员和配置作为同一聚合写入', () => {
    const harness = createGameHarness()
    const { host, room } = startTwoPlayerGame(harness)
    const upsert = vi.fn()
    const saveAggregate = vi.fn()
    const coordinator = new RoomPersistenceCoordinator({
      clock: harness.runtime.clock,
      repositories: {
        players: { upsert },
        rooms: { saveAggregate },
        archive: { saveGame: vi.fn() },
      },
    })
    coordinator.persistPlayer(harness.service.requirePlayer(host.playerId))
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
        'roomId',
        'token',
      ].sort(),
    )
    coordinator.persistRoom(room)
    const [record, members] = saveAggregate.mock.calls[0]!
    expect(record).toMatchObject({
      id: room.id,
      phase: room.phase,
      stateVersion: room.stateVersion,
      updatedAt: harness.runtime.now(),
    })
    expect(JSON.parse(record.settings)).toEqual(room.settings)
    expect(JSON.parse(record.selectedWords)).toEqual([...room.selectedWordIds])
    expect(record).not.toHaveProperty('game')
    expect(members).toHaveLength(2)
    expect(members[0]).toMatchObject({
      roomId: room.id,
      playerId: host.playerId,
      leftGame: false,
      spectating: false,
    })
  })

  it('战报只读取冻结榜单，未结算时不写入，仓储失败原样传播', () => {
    const harness = createGameHarness()
    const { host, room } = startTwoPlayerGame(harness)
    harness.service.persistence.persistGameResult(room, '未结算')
    expect(harness.repositories.archive.games).toHaveLength(0)
    harness.service.endEarly(host.playerId)
    const snapshot = structuredClone(harness.repositories.archive.games[0])
    room.members.length = 0
    harness.service.persistence.persistGameResult(room, '再次映射')
    expect(harness.repositories.archive.games[1]?.results).toEqual(snapshot?.results)
    vi.spyOn(harness.repositories.rooms, 'saveAggregate').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    expect(() => harness.service.persistence.persistRoom(room)).toThrow('storage unavailable')
  })
})
