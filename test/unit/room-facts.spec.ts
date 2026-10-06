import { describe, expect, it } from 'vitest'
import type { RoomPhase } from '@draw-guess/shared'
import { phaseEquivalent, reseatMembers } from '../../apps/server/src/domain/room/room-facts.ts'
import { slidingWindowAllow } from '../../apps/server/src/rate-limit.ts'
import type { RoomSecret } from '../../apps/server/src/models.ts'

/** 把房间压成判定所需的最小形状（其余字段与本口径无关）。 */
function roomOf(phase: RoomPhase): RoomSecret {
  return { phase } as unknown as RoomSecret
}

describe('phaseEquivalent（名义阶段等价判定）', () => {
  it('阶段相同时为 true，不同时或房间未定义时为 false', () => {
    expect(phaseEquivalent(roomOf('drawing'), 'drawing')).toBe(true)
    expect(phaseEquivalent(roomOf('choosing_word'), 'drawing')).toBe(false)
    expect(phaseEquivalent(undefined, 'drawing')).toBe(false)
  })
})

describe('reseatMembers（席位紧凑重排）', () => {
  it('按数组顺序重写 seatIndex，消灭空洞与历史跳号', () => {
    const room = {
      members: [
        { playerId: 'a', seatIndex: 4 },
        { playerId: 'b', seatIndex: 0 },
        { playerId: 'c', seatIndex: 9 },
      ],
    } as unknown as RoomSecret
    reseatMembers(room)
    expect(room.members.map((member) => member.seatIndex)).toEqual([0, 1, 2])
  })
})

describe('slidingWindowAllow（滑动窗口限频单一形状）', () => {
  const WINDOW = 1_000
  const LIMIT = 2

  it('窗口内达上限即拒绝，且拒绝结果仍返回过滤后的队列（窗口随时间前滚）', () => {
    // now=2400：900 已过期被丢弃；2350 在窗口内 → 1 条，未达上限 2 → 放行并登记
    const allow = slidingWindowAllow([900, 2_350], 2_400, WINDOW, LIMIT)
    expect(allow.allowed).toBe(true)
    expect(allow.times).toEqual([2_350, 2_400])
    // 同样窗口下两条都在窗口内即达上限：拒绝且**不**登记本次时间戳（被拒不占额度）
    const deny = slidingWindowAllow([2_350, 2_360], 2_400, WINDOW, LIMIT)
    expect(deny.allowed).toBe(false)
    expect(deny.times).toEqual([2_350, 2_360])
  })

  it('恰在窗口边界的记录视为过期（严格小于才保留）', () => {
    const decision = slidingWindowAllow([1_400], 2_400, WINDOW, LIMIT)
    expect(decision.allowed).toBe(true)
    expect(decision.times).toEqual([2_400])
  })

  it('恰好等于上限的旧记录全部过期时重新放行', () => {
    const decision = slidingWindowAllow([0, 1], 5_000, WINDOW, LIMIT)
    expect(decision.allowed).toBe(true)
    expect(decision.times).toEqual([5_000])
  })
})
