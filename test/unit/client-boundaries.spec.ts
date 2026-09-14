import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import { EVENTS, createServerPush, type RoomSnapshot, type RoomSettings } from '@draw-guess/shared'
import { applyFloodFill, colorToRgba } from '../../apps/client/src/canvas/flood-fill.ts'
import {
  clearProtocolDiagnostics,
  decodeServerPush,
  getProtocolDiagnostics,
} from '../../apps/client/src/stores/push-protocol.ts'
import {
  acceptDrawingIncrement,
  acceptRoomSnapshot,
} from '../../apps/client/src/stores/snapshot-gate.ts'
import { VocabularyRequestGuard } from '../../apps/client/src/stores/vocabulary-request-context.ts'
import { testRoomSettings } from './helpers/game-harness.ts'
import { selectTopmostDialog } from '../../apps/client/src/components/common/dialog-stack.ts'

const ROOM_ID = '00000000-0000-4000-8000-000000000001'
const HOST_ID = '00000000-0000-4000-8000-000000000002'
const GAME_ID = '00000000-0000-4000-8000-000000000003'
const ROUND_ID = '00000000-0000-4000-8000-000000000004'

function snapshot(settings: RoomSettings = testRoomSettings()): RoomSnapshot {
  return {
    id: ROOM_ID,
    name: '测试房',
    hostId: HOST_ID,
    visibility: 'public',
    phase: 'drawing',
    stateVersion: 5,
    settings,
    members: [],
    selectedWordCount: 60,
    totalWordCount: 60,
    game: {
      gameId: GAME_ID,
      roundId: ROUND_ID,
      currentRound: 1,
      totalRounds: 2,
      drawerId: HOST_ID,
      phaseStartedAt: 1_000,
      phaseEndsAt: 91_000,
      answerMask: '＊＊＊',
      strokes: [],
      undoneStrokeIds: [],
      lastSequence: -1,
      drawingRevision: 2,
      messages: [],
    },
  }
}

describe('推送协议与版本门禁', () => {
  it('完整信封可解码；字段缺失、Secret 注入和协议不匹配均被拒绝并记录诊断', () => {
    clearProtocolDiagnostics()
    expect(decodeServerPush(EVENTS.roomSnapshot, createServerPush(snapshot())).ok).toBe(true)
    expect(
      decodeServerPush(EVENTS.roomSnapshot, createServerPush({ ...snapshot(), members: undefined }))
        .ok,
    ).toBe(false)
    expect(
      decodeServerPush(
        EVENTS.roomSnapshot,
        createServerPush({ ...snapshot(), requestCache: { secret: true } }),
      ).ok,
    ).toBe(false)
    expect(
      decodeServerPush(EVENTS.roomSnapshot, {
        protocolVersion: 'old',
        data: snapshot(),
      }).ok,
    ).toBe(false)
    expect(getProtocolDiagnostics()).toHaveLength(3)
  })

  it('拒绝乱序快照、旧回合增量和重复 revision，并对修订缺口要求重同步', () => {
    const current = snapshot()
    expect(acceptRoomSnapshot(current, { ...current, stateVersion: 4 })).toBe('ignore')
    expect(
      acceptRoomSnapshot(current, {
        ...current,
        game: { ...current.game!, drawingRevision: 1 },
      }),
    ).toBe('ignore')
    expect(
      acceptDrawingIncrement(current, {
        roomId: ROOM_ID,
        gameId: GAME_ID,
        roundId: '00000000-0000-4000-8000-000000000099',
        drawingRevision: 3,
      }),
    ).toBe('ignore')
    expect(
      acceptDrawingIncrement(current, {
        roomId: ROOM_ID,
        gameId: GAME_ID,
        roundId: ROUND_ID,
        drawingRevision: 2,
      }),
    ).toBe('ignore')
    expect(
      acceptDrawingIncrement(current, {
        roomId: ROOM_ID,
        gameId: GAME_ID,
        roundId: ROUND_ID,
        drawingRevision: 4,
      }),
    ).toBe('resync')
  })
})

describe('词库异步上下文', () => {
  it('拒绝旧会话、旧房间、旧词库包与关闭后返回的响应', () => {
    const guard = new VocabularyRequestGuard()
    const context = guard.begin({ sessionGeneration: 1, roomId: ROOM_ID }, 'package-a')!
    expect(guard.accepts(context, { sessionGeneration: 1, roomId: ROOM_ID }, 'package-a')).toBe(
      true,
    )
    expect(guard.accepts(context, { sessionGeneration: 2, roomId: ROOM_ID }, 'package-a')).toBe(
      false,
    )
    expect(
      guard.accepts(
        context,
        { sessionGeneration: 1, roomId: '00000000-0000-4000-8000-000000000099' },
        'package-a',
      ),
    ).toBe(false)
    expect(guard.accepts(context, { sessionGeneration: 1, roomId: ROOM_ID }, 'package-b')).toBe(
      false,
    )
    guard.invalidate()
    expect(guard.accepts(context, { sessionGeneration: 1, roomId: ROOM_ID }, 'package-a')).toBe(
      false,
    )
  })
})

describe('洪泛填充固定逻辑缓冲', () => {
  it.each([10, 15, 20])('在等价 DPR/尺寸栅格 %i 上只填充边界左侧且不吃实线', (size) => {
    const data = new Uint8ClampedArray(size * size * 4)
    const boundaryX = Math.floor(size / 2)
    for (let y = 0; y < size; y += 1) {
      const offset = (y * size + boundaryX) * 4
      data.set([31, 41, 55, 255], offset)
    }
    const filled = applyFloodFill(
      data,
      size,
      size,
      1,
      Math.floor(size / 2),
      colorToRgba('#EF4444'),
      APP_CONFIG.drawing.fillTolerance,
    )
    expect(filled).toBe(boundaryX * size)
    const left = (Math.floor(size / 2) * size + 1) * 4
    const boundary = (Math.floor(size / 2) * size + boundaryX) * 4
    const right = (Math.floor(size / 2) * size + size - 2) * 4
    expect([...data.slice(left, left + 4)]).toEqual([239, 68, 68, 255])
    expect([...data.slice(boundary, boundary + 4)]).toEqual([31, 41, 55, 255])
    expect([...data.slice(right, right + 4)]).toEqual([0, 0, 0, 0])
  })
})

describe('通用组件边界', () => {
  it('多层 BaseDialog 仲裁只选择可见且层级最高的最后一个弹窗', () => {
    const dialogs = [
      { id: 'base', visible: true, z: 30 },
      { id: 'hidden', visible: false, z: 100 },
      { id: 'system-a', visible: true, z: 50 },
      { id: 'system-b', visible: true, z: 50 },
    ]
    expect(
      selectTopmostDialog(
        dialogs,
        (dialog) => dialog.visible,
        (dialog) => dialog.z,
      )?.id,
    ).toBe('system-b')
  })
})
