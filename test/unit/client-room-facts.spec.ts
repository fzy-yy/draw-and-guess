import { describe, expect, it } from 'vitest'
import { strings } from '@draw-guess/strings'
import type { RoomMember } from '@draw-guess/shared'
import { phaseTextFor } from '../../apps/client/src/utils/phase-text.ts'
import {
  activeMembers,
  isActiveMember,
  playerCountOptions,
} from '../../apps/client/src/utils/room-facts.ts'
import { createRoomFixture } from '../client/room-fixture'

function member(overrides: Partial<RoomMember> = {}): RoomMember {
  return { ...createRoomFixture().members[0]!, ...overrides }
}

describe('客户端房间事实单一口径', () => {
  it('phaseTextFor 覆盖阶段并缺省回退 waiting', () => {
    expect(phaseTextFor('drawing')).toBe(strings.status.phaseDrawing)
    expect(phaseTextFor('paused')).toBe(strings.status.phasePaused)
    expect(phaseTextFor('closed')).toBe(strings.status.phaseClosed)
    expect(phaseTextFor(undefined)).toBe(strings.status.phaseWaiting)
  })

  it('isActiveMember / activeMembers 排除观战与离局', () => {
    const active = member({ id: 'a' })
    const spectator = member({ id: 's', spectating: true })
    const departed = member({ id: 'd', leftGame: true })

    expect(isActiveMember(active)).toBe(true)
    expect(isActiveMember(spectator)).toBe(false)
    expect(isActiveMember(departed)).toBe(false)
    expect(activeMembers([active, spectator, departed]).map((item) => item.id)).toEqual(['a'])
  })

  it('playerCountOptions 生成闭区间选项且文案走 strings', () => {
    expect(playerCountOptions({ min: 2, max: 4 })).toEqual([
      { value: 2, label: strings.common.playersUnit(2) },
      { value: 3, label: strings.common.playersUnit(3) },
      { value: 4, label: strings.common.playersUnit(4) },
    ])
  })
})
