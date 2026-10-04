import { describe, expect, it } from 'vitest'
import { acceptRoomSnapshot } from '@/stores/snapshot-gate'
import { STEP_ID, createRelayRoomFixture, createRoomFixture } from '../client/room-fixture'

/**
 * 快照门禁的接龙分支（S60）：接龙房没有经典 `game` 字段，改按
 * 「步骤 id + 画布修订 + 状态版本」三键裁决；经典分支的行为由 `test/unit/client-boundaries.spec.ts` 守护，
 * 这里同时钉一条经典用例，确保加入接龙分支后经典裁决没有被顺带改动。
 */

const NEXT_STEP_ID = '00000000-0000-4000-8000-00000000000e'

describe('acceptRoomSnapshot 接龙分支', () => {
  it('同一步骤内画布修订倒退的迟到包被丢弃（否则会覆盖本客户端已落地的笔画）', () => {
    const current = createRelayRoomFixture('relay_draw', {
      ownCanvas: { strokes: [], undoneStrokeIds: [], lastSequence: 2, drawingRevision: 2 },
    })
    const stale = createRelayRoomFixture('relay_draw', {
      ownCanvas: { strokes: [], undoneStrokeIds: [], lastSequence: 1, drawingRevision: 1 },
    })
    expect(acceptRoomSnapshot(current, stale)).toBe('ignore')
  })

  it('同一步骤内容相同或修订前进都采纳', () => {
    const current = createRelayRoomFixture('relay_draw', {
      ownCanvas: { strokes: [], undoneStrokeIds: [], lastSequence: 1, drawingRevision: 1 },
    })
    const equal = createRelayRoomFixture('relay_draw', {
      ownCanvas: { strokes: [], undoneStrokeIds: [], lastSequence: 1, drawingRevision: 1 },
    })
    const newer = createRelayRoomFixture('relay_draw', {
      ownCanvas: { strokes: [], undoneStrokeIds: [], lastSequence: 2, drawingRevision: 2 },
    })
    expect(acceptRoomSnapshot(current, equal)).toBe('accept')
    expect(acceptRoomSnapshot(current, newer)).toBe('accept')
  })

  it('换棒（步骤 id 变化）即采纳：新步骤的画布与本步不同源，修订号不具可比性', () => {
    const current = createRelayRoomFixture('relay_draw', {
      ownCanvas: { strokes: [], undoneStrokeIds: [], lastSequence: 5, drawingRevision: 5 },
    })
    const nextStep = createRelayRoomFixture('relay_guess', {
      currentStep: 2,
      stepId: NEXT_STEP_ID,
      previousDrawing: { strokes: [], undoneStrokeIds: [], lastSequence: 0, drawingRevision: 0 },
    })
    expect(acceptRoomSnapshot(current, nextStep)).toBe('accept')
  })

  it('状态版本倒退一律丢弃；本地尚无接龙视图时采纳（首次推送 / 重连落位）', () => {
    const current = createRelayRoomFixture('relay_draw')
    const older = createRelayRoomFixture('relay_draw', {}, { stateVersion: 0 })
    expect(acceptRoomSnapshot(current, older)).toBe('ignore')

    const withoutRelayView = createRelayRoomFixture('relay_draw')
    delete withoutRelayView.relay
    expect(acceptRoomSnapshot(withoutRelayView, current)).toBe('accept')
  })

  it('接龙局回退（载荷不再带接龙视图）只有状态版本前进才可信', () => {
    const current = createRelayRoomFixture('relay_draw')
    const fallback = createRelayRoomFixture('relay_draw')
    delete fallback.relay
    expect(acceptRoomSnapshot(current, fallback)).toBe('ignore')
    expect(acceptRoomSnapshot(current, { ...fallback, stateVersion: 2 })).toBe('accept')
  })

  it('接龙取哪幅画布的修订：作画棒取自己的、猜词棒取上家的、复盘取当前半场', () => {
    const drawing = createRelayRoomFixture('relay_draw', {
      ownCanvas: { strokes: [], undoneStrokeIds: [], lastSequence: 0, drawingRevision: 3 },
    })
    const drawingStale = createRelayRoomFixture('relay_draw', {
      ownCanvas: { strokes: [], undoneStrokeIds: [], lastSequence: 0, drawingRevision: 2 },
    })
    expect(acceptRoomSnapshot(drawing, drawingStale)).toBe('ignore')

    const guess = createRelayRoomFixture('relay_guess', {
      currentStep: 2,
      previousDrawing: { strokes: [], undoneStrokeIds: [], lastSequence: 0, drawingRevision: 3 },
    })
    const guessStale = createRelayRoomFixture('relay_guess', {
      currentStep: 2,
      previousDrawing: { strokes: [], undoneStrokeIds: [], lastSequence: 0, drawingRevision: 2 },
    })
    expect(acceptRoomSnapshot(guess, guessStale)).toBe('ignore')

    // 复盘期展示的是当前半场的画作：修订同样不允许倒退
    const player = { id: STEP_ID, nickname: '画家', avatarId: '01' as const }
    const showcase = {
      chainIndex: 1,
      chainCount: 4,
      half: 1 as const,
      prompt: { player, text: '气球' },
      answer: { player, text: null },
    }
    const reveal = createRelayRoomFixture('relay_showcase', {
      showcase: {
        ...showcase,
        drawing: { strokes: [], undoneStrokeIds: [], lastSequence: 0, drawingRevision: 4 },
      },
    })
    const revealStale = createRelayRoomFixture('relay_showcase', {
      showcase: {
        ...showcase,
        drawing: { strokes: [], undoneStrokeIds: [], lastSequence: 0, drawingRevision: 3 },
      },
    })
    expect(acceptRoomSnapshot(reveal, revealStale)).toBe('ignore')
    expect(acceptRoomSnapshot(revealStale, reveal)).toBe('accept')
  })

  it('经典分支不受影响：同回合修订倒退仍丢弃、状态版本倒退仍丢弃', () => {
    const current = createRoomFixture('drawing', { drawingRevision: 3 })
    expect(
      acceptRoomSnapshot(current, {
        ...current,
        game: { ...current.game!, drawingRevision: 1 },
      }),
    ).toBe('ignore')
    expect(acceptRoomSnapshot(current, { ...current, stateVersion: 0 })).toBe('ignore')
    // 同一份快照（同修订、同状态版本）仍可接收：聊天这类高频状态不为每条消息推进房间版本
    expect(acceptRoomSnapshot(current, { ...current })).toBe('accept')
  })
})
