import { describe, expect, it } from 'vitest'
import { strings } from '@draw-guess/strings'
import type { RoomMember } from '@draw-guess/shared'
import { phaseTextFor } from '../../apps/client/src/utils/phase-text.ts'
import {
  activeMembers,
  isActiveMember,
  isOnlineActiveMember,
  occupiesSeatMember,
} from '../../apps/client/src/utils/room-facts.ts'
import { createRoomFixture } from '../client/room-fixture'

function member(overrides: Partial<RoomMember> = {}): RoomMember {
  return { ...createRoomFixture().members[0]!, ...overrides }
}

describe('客户端房间事实单一口径', () => {
  it('phaseTextFor 覆盖阶段并缺省回退 waiting', () => {
    expect(phaseTextFor('drawing')).toBe(strings.ui.status.phaseDrawing)
    expect(phaseTextFor('closed')).toBe(strings.ui.status.phaseClosed)
    expect(phaseTextFor(undefined)).toBe(strings.ui.status.phaseWaiting)
  })

  it('isActiveMember / activeMembers 只排除离局者', () => {
    const active = member({ id: 'a' })
    const departed = member({ id: 'd', leftGame: true })

    expect(isActiveMember(active)).toBe(true)
    expect(isActiveMember(departed)).toBe(false)
    expect(activeMembers([active, departed]).map((item) => item.id)).toEqual(['a'])
  })

  it('occupiesSeatMember 只排除离局者', () => {
    // 占席是容量口径（ADR-0023）：离局者为成绩卡保留的占位不再占席
    expect(occupiesSeatMember(member())).toBe(true)
    expect(occupiesSeatMember(member({ leftGame: true }))).toBe(false)
  })

  it('isOnlineActiveMember 只认连接在线', () => {
    expect(isOnlineActiveMember(member({ connection: 'online' }))).toBe(true)
    expect(isOnlineActiveMember(member({ connection: 'reconnecting' }))).toBe(false)
    expect(isOnlineActiveMember(member({ connection: 'left' }))).toBe(false)
  })
})
