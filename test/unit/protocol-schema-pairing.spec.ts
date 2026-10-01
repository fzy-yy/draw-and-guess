import { describe, expect, it } from 'vitest'
import { defaultRoomSettings } from '@draw-guess/config'
import {
  EVENTS,
  PROTOCOL_VERSION,
  RoomSettingsSchema,
  SERVER_PUSH_SCHEMAS,
  type RoomSnapshot,
} from '@draw-guess/shared'

/**
 * 协议 Schema 正/负向配对（与 test/type/schema-first.ts 同源）：
 * 正向证明当前 DTO 能通过 strict 校验；负向证明越界字段、缺失必填字段，
 * 以及已删除的结构化提示字段（structuredHintsEnabled / hintStartRatio / wordHint / revealedHints）
 * 都会被拒绝——防止旧字段回潮（见 ADR-0042）。
 * 只断言协议边界本身，不触碰快照裁剪实现。
 */

const HOST_ID = '00000000-0000-4000-8000-000000000001'
const ROOM_ID = '00000000-0000-4000-8000-000000000003'
const GAME_ID = '00000000-0000-4000-8000-000000000004'
const ROUND_ID = '00000000-0000-4000-8000-000000000005'

function validSnapshot(): RoomSnapshot {
  return {
    id: ROOM_ID,
    name: '协议房间',
    hostId: HOST_ID,
    visibility: 'public',
    phase: 'drawing',
    stateVersion: 1,
    settings: defaultRoomSettings(6),
    members: [],
    selectedWordCount: 0,
    totalWordCount: 0,
    game: {
      gameId: GAME_ID,
      roundId: ROUND_ID,
      currentRound: 1,
      totalRounds: 2,
      drawerId: HOST_ID,
      phaseStartedAt: 1_000,
      phaseEndsAt: 61_000,
      answerMask: '＿ ＿',
      answer: '苹果',
      strokes: [],
      undoneStrokeIds: [],
      lastSequence: -1,
      drawingRevision: 0,
      messages: [],
    },
  }
}

/** 推送 schema 的版本化信封（与 createServerPush 同形）。 */
function envelope(data: unknown): unknown {
  return { protocolVersion: PROTOCOL_VERSION, data }
}

const roomSnapshotPush = SERVER_PUSH_SCHEMAS[EVENTS.roomSnapshot]

describe('RoomSettingsSchema 正/负向配对', () => {
  it('默认规则组通过 strict 校验', () => {
    expect(RoomSettingsSchema.safeParse(defaultRoomSettings(6)).success).toBe(true)
  })

  it('已删除的结构化提示字段作为未知键被拒绝（strict 防回潮）', () => {
    const valid = defaultRoomSettings(6)
    expect(RoomSettingsSchema.safeParse({ ...valid, structuredHintsEnabled: true }).success).toBe(
      false,
    )
    expect(RoomSettingsSchema.safeParse({ ...valid, hintStartRatio: 0.5 }).success).toBe(false)
  })

  it('越界与错误类型被拒绝', () => {
    const valid = defaultRoomSettings(6)
    expect(RoomSettingsSchema.safeParse({ ...valid, progressiveHints: 1 }).success).toBe(false)
    expect(RoomSettingsSchema.safeParse({ ...valid, extraGuessSeconds: 91 }).success).toBe(false)
  })
})

describe('对局推送 Schema 正/负向配对', () => {
  it('合法房间快照（含画家答案明文）通过 strict 校验', () => {
    expect(roomSnapshotPush.safeParse(envelope(validSnapshot())).success).toBe(true)
  })

  it('缺少必填字段（answerMask）被拒绝', () => {
    const { answerMask: _omitted, ...gameWithoutMask } = validSnapshot().game!
    const broken = { ...validSnapshot(), game: gameWithoutMask }
    expect(roomSnapshotPush.safeParse(envelope(broken)).success).toBe(false)
  })

  it('已删除的结构化提示字段（wordHint / revealedHints）被拒绝', () => {
    const base = validSnapshot()
    const withWordHint = { ...base, game: { ...base.game!, wordHint: '提示' } }
    const withRevealedHints = { ...base, game: { ...base.game!, revealedHints: ['提示'] } }
    expect(roomSnapshotPush.safeParse(envelope(withWordHint)).success).toBe(false)
    expect(roomSnapshotPush.safeParse(envelope(withRevealedHints)).success).toBe(false)
  })

  it('房间设置里的旧提示字段经推送边界同样被拒绝', () => {
    const base = validSnapshot()
    const withStructured = {
      ...base,
      settings: { ...defaultRoomSettings(6), structuredHintsEnabled: true },
    }
    expect(roomSnapshotPush.safeParse(envelope(withStructured)).success).toBe(false)
  })
})
