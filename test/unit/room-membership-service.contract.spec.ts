import { describe, expect, it, vi } from 'vitest'
import { EVENTS, ROOM_CLOSE_CODE } from '@draw-guess/shared'
import { serverStrings } from '@draw-guess/strings'
import { createGameHarness, testRoomSettings } from './helpers/game-harness.ts'

describe('RoomMembershipService 契约', () => {
  it('房间加入不写穿身份或战报仓储', () => {
    const harness = createGameHarness()
    const host = harness.register('房主')
    const guest = harness.register('访客')
    const created = harness.backend.room.createRoom(host.playerId, {
      name: '成员房间',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    const room = harness.backend.rooms.get(created.id)!
    const persistIdentity = vi
      .spyOn(harness.repositories.players, 'upsert')
      .mockImplementation(() => {
        throw new Error('房间流程不应触达身份仓储')
      })
    const persistArchive = vi.spyOn(harness.repositories.archive, 'saveGame')
    expect(() => harness.backend.room.joinRoom(guest.playerId, room.id)).not.toThrow()
    expect(room.members.map((member) => member.playerId)).toEqual([host.playerId, guest.playerId])
    expect(guest.socket.rooms.has(room.id)).toBe(true)
    expect(harness.backend.requirePlayer(guest.playerId).roomId).toBe(room.id)
    expect(persistIdentity).not.toHaveBeenCalled()
    expect(persistArchive).not.toHaveBeenCalled()
  })

  it('私密房迁移房主会轮换短码，旧码失效且新房主可以踢人', () => {
    const harness = createGameHarness()
    const host = harness.register('房主')
    const guest = harness.register('访客')
    const created = harness.backend.room.createRoom(host.playerId, {
      name: '私密房',
      visibility: 'private',
      settings: testRoomSettings(),
    })
    const oldCode = created.privateJoinCode!
    harness.backend.room.joinPrivateRoom(guest.playerId, oldCode)
    harness.backend.room.transferHost(host.playerId, guest.playerId)
    const room = harness.backend.rooms.get(created.id)!
    expect(room.hostId).toBe(guest.playerId)
    expect(room.privateJoinCode).not.toBe(oldCode)
    expect(harness.backend.roomsByPrivateCode.has(oldCode)).toBe(false)
    harness.backend.room.kick(guest.playerId, host.playerId)
    expect(room.members.map((member) => member.playerId)).toEqual([guest.playerId])
    expect(host.socket.rooms.has(room.id)).toBe(false)
    // 被踢通知必须携带稳定关闭码，客户端不再依赖展示文案判定业务语义。
    expect(host.socket.events).toContainEqual(
      expect.objectContaining({
        event: EVENTS.roomClosed,
        payload: expect.objectContaining({
          data: expect.objectContaining({
            reason: serverStrings.notices.kickedReason,
            code: ROOM_CLOSE_CODE.kicked,
          }),
        }),
      }),
    )
  })
})
