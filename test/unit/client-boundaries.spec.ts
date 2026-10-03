import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import {
  CLIENT_REQUEST_SCHEMAS,
  CLIENT_RESPONSE_SCHEMAS,
  EVENTS,
  createServerPush,
  type RoomSnapshot,
  type RoomSettings,
} from '@draw-guess/shared'
import { applyFloodFillMeasured, colorToRgba } from '../../apps/client/src/canvas/flood-fill.ts'
import {
  clearProtocolDiagnostics,
  decodeServerPush,
  getProtocolDiagnostics,
} from '../../apps/client/src/stores/push-protocol.ts'
import {
  clearResponseDiagnostics,
  decodeClientResponse,
  getResponseDiagnostics,
} from '../../apps/client/src/stores/response-protocol.ts'
import {
  clearFillDiagnostics,
  getFillDiagnostics,
  recordFillDiagnostic,
} from '../../apps/client/src/canvas/fill-diagnostics.ts'
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
    expect(
      decodeServerPush(EVENTS.roomSnapshot, createServerPush(EVENTS.roomSnapshot, snapshot())).ok,
    ).toBe(true)
    // 非法 data（members 缺失 / 注入 Secret）不走 createServerPush（其签名会拒绝），
    // 手写信封模拟「线上收到损坏/越权字节」。
    expect(
      decodeServerPush(EVENTS.roomSnapshot, {
        protocolVersion: APP_CONFIG.app.protocolVersion,
        data: { ...snapshot(), members: undefined },
      }),
    ).toEqual({ ok: false, reason: 'invalid_payload' })
    expect(
      decodeServerPush(EVENTS.roomSnapshot, {
        protocolVersion: APP_CONFIG.app.protocolVersion,
        data: { ...snapshot(), requestCache: { secret: true } },
      }),
    ).toEqual({ ok: false, reason: 'invalid_payload' })
    expect(
      decodeServerPush(EVENTS.roomSnapshot, {
        protocolVersion: 'old',
        data: snapshot(),
      }),
    ).toEqual({ ok: false, reason: 'protocol_mismatch' })
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
    // 门禁裁决：本地无房间快照时重同步入口无从发起（需 roomId），改判 ignore 丢弃
    // （见 docs/adr/0041-snapshot-gate-decision-narrowing.md）。
    expect(
      acceptDrawingIncrement(undefined, {
        roomId: ROOM_ID,
        gameId: GAME_ID,
        roundId: ROUND_ID,
        drawingRevision: 3,
      }),
    ).toBe('ignore')
    // 门禁不放宽：本地快照尚无 game（镜像落后于开局推送）仍须 resync。
    expect(
      acceptDrawingIncrement(
        { ...current, game: undefined },
        {
          roomId: ROOM_ID,
          gameId: GAME_ID,
          roundId: ROUND_ID,
          drawingRevision: 3,
        },
      ),
    ).toBe('resync')
  })
})

describe('请求响应注册表与 ack 边界', () => {
  const requestId = '00000000-0000-4000-8000-0000000000aa'
  type ResponseEvent = keyof typeof CLIENT_RESPONSE_SCHEMAS
  const responseEvents = Object.keys(CLIENT_RESPONSE_SCHEMAS) as ResponseEvent[]

  it('请求与响应 Schema 注册表一一对应，失败分支对所有事件形状一致', () => {
    expect(Object.keys(CLIENT_RESPONSE_SCHEMAS).sort()).toEqual(
      Object.keys(CLIENT_REQUEST_SCHEMAS).sort(),
    )
    for (const event of responseEvents) {
      const schema = CLIENT_RESPONSE_SCHEMAS[event]
      expect(
        schema.safeParse({
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' },
          requestId,
        }).success,
        event,
      ).toBe(true)
      // 未登记错误码、外壳额外字段与缺失 requestId 都必须被拒绝。
      expect(
        schema.safeParse({
          ok: false,
          error: { code: 'NOT_REGISTERED', message: 'x' },
          requestId,
        }).success,
        event,
      ).toBe(false)
      expect(
        schema.safeParse({
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'x' },
          requestId,
          extra: true,
        }).success,
        event,
      ).toBe(false)
      expect(
        schema.safeParse({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'x' } }).success,
        event,
      ).toBe(false)
    }
  })

  it('成功响应允许缺省 data 的事件集合与 void/undefined 语义完全一致', () => {
    const emptyDataEvents = [
      EVENTS.presenceUpdatePreferences,
      EVENTS.roomLeave,
      EVENTS.roomKick,
      EVENTS.roomTransferHost,
      EVENTS.gameChooseWord,
      EVENTS.gameRerollWords,
      EVENTS.gameCustomWord,
      EVENTS.gamePauseRequest,
      EVENTS.gameResume,
      EVENTS.gameEndEarly,
      EVENTS.gameLeave,
      EVENTS.gameReturnWaiting,
      EVENTS.chatPreset,
      EVENTS.drawUndo,
      EVENTS.drawRedo,
      EVENTS.drawClear,
      EVENTS.gameCanvasPing,
      // 成功但可能没有房间：invite:respond / state:resync 允许 data 缺省。
      EVENTS.inviteRespond,
      EVENTS.stateResync,
    ].sort()
    const accepted = responseEvents
      .filter((event) => CLIENT_RESPONSE_SCHEMAS[event].safeParse({ ok: true, requestId }).success)
      .sort()
    expect(accepted).toEqual(emptyDataEvents)
  })

  it('畸形成功响应统一拒绝：缺 data、data 类型错误、缺 requestId', () => {
    clearResponseDiagnostics()
    expect(decodeClientResponse(EVENTS.roomCreate, { ok: true, requestId }, requestId)).toEqual({
      status: 'invalid',
      reason: 'invalid_payload',
    })
    expect(
      decodeClientResponse(
        EVENTS.roomCreate,
        { ok: true, data: { id: 'not-a-room' }, requestId },
        requestId,
      ),
    ).toEqual({ status: 'invalid', reason: 'invalid_payload' })
    expect(
      decodeClientResponse(EVENTS.roomCreate, { ok: true, data: snapshot() }, requestId),
    ).toEqual({ status: 'invalid', reason: 'invalid_payload' })
    // 诊断仅保留字段路径与错误类别，绝不记录被拒绝的数据内容。
    const diagnostics = getResponseDiagnostics()
    expect(diagnostics).toHaveLength(3)
    expect(JSON.stringify(diagnostics)).not.toContain('not-a-room')
  })

  it('requestId 不匹配单独归类，诊断有界且导出副本不可改写', () => {
    clearResponseDiagnostics()
    const expectedRequestId = '00000000-0000-4000-8000-0000000000cc'
    for (let index = 0; index < 25; index += 1) {
      expect(
        decodeClientResponse(
          EVENTS.gameResume,
          {
            ok: false,
            requestId: '00000000-0000-4000-8000-000000000001',
            error: { code: 'RATE_LIMITED', message: '请求过于频繁' },
          },
          expectedRequestId,
        ),
      ).toEqual({ status: 'invalid', reason: 'request_id_mismatch' })
    }
    const diagnostics = getResponseDiagnostics()
    expect(diagnostics).toHaveLength(20)
    expect(diagnostics[0]?.reason).toBe('requestId:mismatch')
    for (const item of diagnostics) {
      expect(Object.keys(item).sort()).toEqual(['event', 'reason', 'receivedAt'])
    }
    ;(diagnostics[0] as { reason: string }).reason = 'tampered'
    expect(getResponseDiagnostics()[0]?.reason).toBe('requestId:mismatch')

    clearResponseDiagnostics()
    expect(getResponseDiagnostics()).toHaveLength(0)
    expect(
      decodeClientResponse(EVENTS.roomCreate, { ok: true, data: snapshot(), requestId }, requestId),
    ).toEqual({ status: 'valid', ack: { ok: true, data: snapshot(), requestId } })
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
    const filled = applyFloodFillMeasured(
      data,
      size,
      size,
      1,
      Math.floor(size / 2),
      colorToRgba('#EF4444'),
      APP_CONFIG.drawing.fillTolerance,
    ).filledPixels
    expect(filled).toBe(boundaryX * size)
    const left = (Math.floor(size / 2) * size + 1) * 4
    const boundary = (Math.floor(size / 2) * size + boundaryX) * 4
    const right = (Math.floor(size / 2) * size + size - 2) * 4
    expect([...data.slice(left, left + 4)]).toEqual([239, 68, 68, 255])
    expect([...data.slice(boundary, boundary + 4)]).toEqual([31, 41, 55, 255])
    expect([...data.slice(right, right + 4)]).toEqual([0, 0, 0, 0])
  })
})

describe('画布填充诊断', () => {
  it('只保留最近的有界条数，且导出副本不可被外部改写', () => {
    clearFillDiagnostics()
    for (let index = 0; index < 25; index += 1) {
      recordFillDiagnostic(index % 2 === 0 ? 'worker_degraded' : 'fill_unavailable')
    }

    const diagnostics = getFillDiagnostics()
    expect(diagnostics).toHaveLength(20)
    // 只保留原因与时间：不含坐标、颜色、像素或答案等可复现画面内容。
    expect(Object.keys(diagnostics[0]!).sort()).toEqual(['reason', 'receivedAt'])
    expect(diagnostics[0]!.reason).toBe('fill_unavailable')

    ;(diagnostics[0] as { reason: string }).reason = 'tampered'
    expect(getFillDiagnostics()[0]!.reason).toBe('fill_unavailable')

    clearFillDiagnostics()
    expect(getFillDiagnostics()).toHaveLength(0)
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
