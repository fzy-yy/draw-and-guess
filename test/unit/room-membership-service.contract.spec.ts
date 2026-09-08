import { describe, expect, it, vi } from 'vitest'
import { createGameHarness, testRoomSettings } from './helpers/game-harness.ts'

describe('RoomMembershipService 契约', () => {
  it('加入落盘失败时回滚成员、版本、玩家归属和 Socket 房间', () => {
    const harness = createGameHarness()
    const host = harness.register('房主')
    const guest = harness.register('访客')
    const created = harness.service.membership.createRoom(host.playerId, {
      name: '成员房间',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    const room = harness.service.rooms.get(created.id)!
    const version = room.stateVersion
    vi.spyOn(harness.repositories.rooms, 'saveAggregate').mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })
    expect(() => harness.service.membership.joinRoom(guest.playerId, room.id)).toThrow(
      'storage unavailable',
    )
    expect(room.stateVersion).toBe(version)
    expect(room.members.map((member) => member.playerId)).toEqual([host.playerId])
    expect(guest.socket.rooms.has(room.id)).toBe(false)
    expect(harness.service.requirePlayer(guest.playerId).roomId).toBeUndefined()
  })

  it('私密房迁移房主会轮换短码，旧码失效且新房主可以踢人', () => {
    const harness = createGameHarness()
    const host = harness.register('房主')
    const guest = harness.register('访客')
    const created = harness.service.membership.createRoom(host.playerId, {
      name: '私密房',
      visibility: 'private',
      settings: testRoomSettings(),
    })
    const oldCode = created.privateJoinCode!
    harness.service.membership.joinPrivateRoom(guest.playerId, oldCode)
    harness.service.membership.transferHost(host.playerId, guest.playerId)
    const room = harness.service.rooms.get(created.id)!
    expect(room.hostId).toBe(guest.playerId)
    expect(room.privateJoinCode).not.toBe(oldCode)
    expect(harness.service.roomsByPrivateCode.has(oldCode)).toBe(false)
    harness.service.membership.kick(guest.playerId, host.playerId)
    expect(room.members.map((member) => member.playerId)).toEqual([guest.playerId])
    expect(host.socket.rooms.has(room.id)).toBe(false)
  })
})
