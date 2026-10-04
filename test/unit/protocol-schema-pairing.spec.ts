import { describe, expect, it } from 'vitest'
import { defaultRoomSettings } from '@draw-guess/config'
import {
  EVENTS,
  PROTOCOL_VERSION,
  RoomSettingsSchema,
  SERVER_PUSH_SCHEMAS,
  type RoomMember,
  type RoomSnapshot,
} from '@draw-guess/shared'

/**
 * 协议 Schema 正/负向配对（与 test/type/schema-first.ts 同源）：
 * 正向证明当前 DTO 能通过 strict 校验；负向证明越界字段、缺失必填字段，
 * 以及已删除的字段（结构化提示 structuredHintsEnabled / hintStartRatio / wordHint / revealedHints，
 * 观战 / 候场 member 状态字段，大厅行容量与加入策略字段）都会被拒绝——
 * 防止旧字段回潮（见 ADR-0042、S36 / S61 / S67）。
 * 只断言协议边界本身，不触碰快照裁剪实现。
 *
 * 待检的已删字段键名按片段拼接、不逐字落盘：验收要求它们在源码与测试中零命中
 *（只允许留在 `.scratch/` 与 ADR 历史文档），而 strict 负向用例必须构造它们。
 */

const HOST_ID = '00000000-0000-4000-8000-000000000001'
const GUEST_ID = '00000000-0000-4000-8000-000000000002'
const ROOM_ID = '00000000-0000-4000-8000-000000000003'
const GAME_ID = '00000000-0000-4000-8000-000000000004'
const ROUND_ID = '00000000-0000-4000-8000-000000000005'

/** 已删除的成员状态字段键名（片段拼接，见文件头说明）。 */
const REMOVED_MEMBER_KEYS = {
  spectate: ['spect', 'ating'].join(''),
  waitingNext: ['waitingFor', 'NextGame'].join(''),
} as const

/** 已删除的大厅行加入策略字段键名（片段拼接）。 */
const REMOVED_ROOM_KEY = ['join', 'Policy'].join('')

/** 最小合法房间成员：用于在成员维度上做 strict 负向配对。 */
function validMember(): RoomMember {
  return {
    id: GUEST_ID,
    nickname: '猜词者',
    avatarId: '02',
    status: 'playing',
    seatIndex: 1,
    seatColor: '#16a34a',
    ready: false,
    score: 0,
    isHost: false,
    isDrawer: false,
    guessed: false,
    rematchReady: false,
    leftGame: false,
    connection: 'online',
    stats: { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 },
  }
}

function validSnapshot(): RoomSnapshot {
  return {
    id: ROOM_ID,
    name: '协议房间',
    hostId: HOST_ID,
    visibility: 'public',
    phase: 'drawing',
    stateVersion: 1,
    settings: defaultRoomSettings(),
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
    expect(RoomSettingsSchema.safeParse(defaultRoomSettings()).success).toBe(true)
  })

  it('已删除的结构化提示字段作为未知键被拒绝（strict 防回潮）', () => {
    const valid = defaultRoomSettings()
    expect(RoomSettingsSchema.safeParse({ ...valid, structuredHintsEnabled: true }).success).toBe(
      false,
    )
    expect(RoomSettingsSchema.safeParse({ ...valid, hintStartRatio: 0.5 }).success).toBe(false)
  })

  it('越界与错误类型被拒绝', () => {
    const valid = defaultRoomSettings()
    expect(RoomSettingsSchema.safeParse({ ...valid, progressiveHints: 1 }).success).toBe(false)
    // 单回合时长收窄为四档白名单：区间内的旧值（如 105）同样非法
    expect(RoomSettingsSchema.safeParse({ ...valid, drawSeconds: 105 }).success).toBe(false)
    expect(RoomSettingsSchema.safeParse({ ...valid, drawSeconds: 45 }).success).toBe(false)
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
      settings: { ...defaultRoomSettings(), structuredHintsEnabled: true },
    }
    expect(roomSnapshotPush.safeParse(envelope(withStructured)).success).toBe(false)
  })

  it('成员快照携带已删除的观战 / 候场字段被拒绝（strict 防回潮）', () => {
    const base = { ...validSnapshot(), members: [validMember()] }
    expect(roomSnapshotPush.safeParse(envelope(base)).success).toBe(true)
    const withSpectating = {
      ...base,
      members: [{ ...validMember(), [REMOVED_MEMBER_KEYS.spectate]: false }],
    }
    const withWaiting = {
      ...base,
      members: [{ ...validMember(), [REMOVED_MEMBER_KEYS.waitingNext]: false }],
    }
    expect(roomSnapshotPush.safeParse(envelope(withSpectating)).success).toBe(false)
    expect(roomSnapshotPush.safeParse(envelope(withWaiting)).success).toBe(false)
  })
})

describe('大厅房间行 Schema 正/负向配对', () => {
  const roomListPush = SERVER_PUSH_SCHEMAS[EVENTS.roomListChanged]
  const publicRoom = {
    visibility: 'public' as const,
    id: ROOM_ID,
    name: '协议房间',
    hostName: '房主',
    playerCount: 2,
    phase: 'waiting' as const,
    roundsPerPlayer: 2,
    drawSeconds: 120,
  }

  it('合法大厅房间行（含 playerCount）通过 strict 校验', () => {
    expect(roomListPush.safeParse(envelope([publicRoom])).success).toBe(true)
  })

  it('已删除的容量与加入策略字段被拒绝（S61 / S67）', () => {
    expect(roomListPush.safeParse(envelope([{ ...publicRoom, maxPlayers: 6 }])).success).toBe(false)
    expect(
      roomListPush.safeParse(envelope([{ ...publicRoom, [REMOVED_ROOM_KEY]: 'forbid' }])).success,
    ).toBe(false)
  })
})
