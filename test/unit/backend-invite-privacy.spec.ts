/**
 * 邀请解析事件的收件人（生产装配缝）。
 *
 * 隐私口径：`invite:resolved` 只发给邀请双方。此前生产侧用 `io.emit` 全局广播，
 * 任何已连接玩家都能观测到不属于自己的邀请活动；同一件事在既有实现里是按当事人定向发送的。
 */
import { describe, expect, it } from 'vitest'
import { EVENTS } from '@draw-guess/shared'
import { createBackendHarness } from './helpers/backend-harness.ts'
import { testRoomSettings } from './helpers/game-harness.ts'

describe('邀请解析事件的收件人', () => {
  it('只发给邀请双方，不向全房间或全世界广播', () => {
    const harness = createBackendHarness()
    const host = harness.register('房主')
    const guest = harness.register('客人')
    const outsider = harness.register('路人')

    const room = harness.backend.room.createRoom(host.playerId, {
      name: '私密房',
      visibility: 'private',
      settings: testRoomSettings(),
    })
    const invite = harness.backend.invitation.send(host.playerId, guest.playerId)
    harness.backend.invitation.respond(guest.playerId, invite.id, true)

    const eventsOf = (socket: { events: { event: string }[] }) =>
      socket.events.map((item) => item.event)

    expect(eventsOf(host.socket)).toContain(EVENTS.inviteResolved)
    expect(eventsOf(guest.socket)).toContain(EVENTS.inviteResolved)
    expect(eventsOf(outsider.socket)).not.toContain(EVENTS.inviteResolved)
    // 全局广播面（io.emit）不得出现邀请活动。
    expect(harness.broadcasts.map((item) => item.event)).not.toContain(EVENTS.inviteResolved)
    // 定向邀请本身也只在被邀请人的连接上出现。
    expect(eventsOf(outsider.socket)).not.toContain(EVENTS.inviteReceived)
    expect(room.id).toBe(invite.roomId)
  })
})
