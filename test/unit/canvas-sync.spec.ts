import { describe, expect, it } from 'vitest'
import {
  invalidateCanvasSync,
  invalidateMemberCanvasSync,
  markAllSynced,
} from '../../apps/server/src/domain/drawing/canvas-sync.ts'
import type { MemberState } from '../../apps/server/src/models.ts'

/** 构造一名最小成员；只覆盖被测字段，其余取默认值。 */
function member(playerId: string, lastSyncedSeq?: number): MemberState {
  return {
    playerId,
    seatIndex: 0,
    ready: false,
    score: 0,
    joinedAt: 0,
    stats: { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 },
    ...(lastSyncedSeq === undefined ? {} : { lastSyncedSeq }),
  }
}

describe('画布同步游标单一口径', () => {
  it('markAllSynced 把房间内全员游标推进到指定序号', () => {
    const a = member('a')
    const b = member('b', 1)
    markAllSynced({ members: [a, b] }, 42)
    expect(a.lastSyncedSeq).toBe(42)
    expect(b.lastSyncedSeq).toBe(42)
  })

  it('invalidateCanvasSync 作废房间内全员游标', () => {
    const a = member('a', 5)
    const b = member('b')
    invalidateCanvasSync({ members: [a, b] })
    expect(a.lastSyncedSeq).toBeUndefined()
    expect(b.lastSyncedSeq).toBeUndefined()
  })

  it('invalidateMemberCanvasSync 只作废指定成员，不影响他人', () => {
    const a = member('a', 5)
    const b = member('b', 7)
    invalidateMemberCanvasSync(a)
    expect(a.lastSyncedSeq).toBeUndefined()
    expect(b.lastSyncedSeq).toBe(7)
  })
})
