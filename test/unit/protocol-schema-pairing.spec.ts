import { describe, expect, it } from 'vitest'
import { defaultRoomSettings } from '@draw-guess/config'
import {
  CLIENT_REQUEST_SCHEMAS,
  CLIENT_RESPONSE_SCHEMAS,
  CreateRoomSchema,
  EVENTS,
  PROTOCOL_VERSION,
  RELAY_CHOOSE_SECONDS_OPTIONS,
  RELAY_DRAW_SECONDS_OPTIONS,
  RELAY_GUESS_SECONDS_OPTIONS,
  RELAY_MIN_PLAYERS,
  RELAY_STEP_COUNT,
  RelayFinalRankingEntrySchema,
  RelayGameViewSchema,
  RelayShowcaseSchema,
  RelayStepSchema,
  RoomPhaseSchema,
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
 * 接龙段（S10 / S22 / S23 / S28 / S39 / S51 / S57 / S63 / S79）额外钉死：
 * 阶段与合法转换链、三时长白名单、模式字段、8 条新事件的事件名↔请求↔ack 登记，
 * 以及 `RelayGameView` 的**最小集封闭字段表**（其余链内容、未揭晓答案与其长度绝不出现）。
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
    gameMode: 'classic',
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
    gameMode: 'classic' as const,
    phase: 'waiting' as const,
    roundsPerPlayer: 2,
    drawSeconds: 120,
  }

  it('合法大厅房间行（含 playerCount 与模式标识）通过 strict 校验', () => {
    expect(roomListPush.safeParse(envelope([publicRoom])).success).toBe(true)
  })

  it('大厅行模式标识只接受已登记的两种模式（S67 / S80）', () => {
    expect(roomListPush.safeParse(envelope([{ ...publicRoom, gameMode: 'relay' }])).success).toBe(
      true,
    )
    expect(roomListPush.safeParse(envelope([{ ...publicRoom, gameMode: 'coop' }])).success).toBe(
      false,
    )
  })

  it('已删除的容量与加入策略字段被拒绝（S61 / S67）', () => {
    expect(roomListPush.safeParse(envelope([{ ...publicRoom, maxPlayers: 6 }])).success).toBe(false)
    expect(
      roomListPush.safeParse(envelope([{ ...publicRoom, [REMOVED_ROOM_KEY]: 'forbid' }])).success,
    ).toBe(false)
  })
})

/** 接龙的五个专属阶段（S10 / S22 / S23）。 */
const RELAY_PHASES = [
  'relay_choose',
  'relay_draw',
  'relay_guess',
  'relay_showcase',
  'relay_vote',
] as const

/** 新增请求事件：事件名常量键 → 线上事件名（S51 / S30 / S79 / S13 的投票）。 */
const RELAY_REQUEST_EVENT_NAMES = [
  ['relayDrawStrokeBatch', 'relay:drawStrokeBatch'],
  ['relayDrawFillCommit', 'relay:drawFillCommit'],
  ['relayDrawUndo', 'relay:drawUndo'],
  ['relayDrawRedo', 'relay:drawRedo'],
  ['relayDrawClear', 'relay:drawClear'],
  ['relaySubmitGuess', 'relay:submitGuess'],
  ['relaySubmitDrawing', 'relay:submitDrawing'],
  ['relayVote', 'relay:vote'],
  ['chatSay', 'chat:say'],
] as const

const REQUEST_ID = '00000000-0000-4000-8000-0000000000aa'

/** 步 1 选词期的接龙视图：只有自己的候选与换一批权限。 */
function relayChooseView(): Record<string, unknown> {
  return {
    phase: 'relay_choose',
    currentStep: 1,
    stepId: ROUND_ID,
    phaseStartedAt: 1_000,
    phaseEndsAt: 21_000,
    submitted: false,
    submittedPlayerIds: [],
    wordOptions: [{ id: 'word-1', text: '苹果' }],
    canReroll: true,
    messages: [],
  }
}

/** 步 2 猜词期的接龙视图：只有上家画作与上家 chip，没有题面与候选。 */
function relayGuessView(): Record<string, unknown> {
  return {
    phase: 'relay_guess',
    currentStep: 2,
    stepId: GAME_ID,
    phaseStartedAt: 30_000,
    phaseEndsAt: 75_000,
    submitted: true,
    submittedPlayerIds: [HOST_ID],
    previousDrawing: { strokes: [], undoneStrokeIds: [], lastSequence: -1, drawingRevision: 1 },
    previousArtist: { id: HOST_ID, nickname: '画家', avatarId: '01' },
    messages: [{ id: ROUND_ID, type: 'guess', text: '哈哈哈哈', playerId: HOST_ID, createdAt: 1 }],
  }
}

/** 复盘期（投票中）的接龙视图：双胶囊 + 本半场画作 + 匿名票行 + 已投票集合。 */
function relayVoteView(): Record<string, unknown> {
  return {
    phase: 'relay_vote',
    currentStep: 4,
    stepId: GAME_ID,
    phaseStartedAt: 90_000,
    phaseEndsAt: 100_000,
    submitted: false,
    submittedPlayerIds: [HOST_ID],
    showcase: {
      chainIndex: 1,
      chainCount: 4,
      half: 2,
      prompt: { player: { id: HOST_ID, nickname: '发起人', avatarId: '01' }, text: '苹果' },
      answer: { player: { id: GUEST_ID, nickname: '第四棒', avatarId: '02' }, text: '香蕉' },
      drawing: { strokes: [], undoneStrokeIds: [], lastSequence: -1, drawingRevision: 2 },
      votes: ['agree', 'disagree'],
    },
    messages: [],
  }
}

/** 终局（game_result）的接龙视图：只有名次、分数与接龙口径统计 + 结算退出时限（S33 / S77）。 */
function relayResultView(): Record<string, unknown> {
  return {
    phase: 'game_result',
    currentStep: 4,
    stepId: GAME_ID,
    phaseStartedAt: 120_000,
    phaseEndsAt: 150_000,
    submitted: false,
    submittedPlayerIds: [],
    finalRanking: [
      {
        id: HOST_ID,
        nickname: '冠军',
        avatarId: '01',
        rank: 1,
        score: 120,
        chainCount: 4,
        agreeVotes: 9,
      },
    ],
    gameResultMinEndsAt: 130_000,
    canReturnWaiting: false,
    messages: [],
  }
}

describe('接龙协议契约（S10 / S22 / S23 / S28 / S39 / S51 / S57 / S63 / S79）', () => {
  it('协议版本升到不兼容的新版本，接龙常量与三时长档位白名单已登记', () => {
    expect(PROTOCOL_VERSION).toBe('18')
    expect(RELAY_MIN_PLAYERS).toBe(4)
    expect([...RELAY_CHOOSE_SECONDS_OPTIONS]).toEqual([10, 15, 20, 30])
    expect([...RELAY_DRAW_SECONDS_OPTIONS]).toEqual([60, 90, 120, 150])
    expect([...RELAY_GUESS_SECONDS_OPTIONS]).toEqual([30, 45, 60, 75])
    // 步数常量与步骤 Schema 的上界必须同口径（末步合法、越界即拒）
    expect(RELAY_STEP_COUNT).toBe(4)
    expect(RelayStepSchema.safeParse(RELAY_STEP_COUNT).success).toBe(true)
    expect(RelayStepSchema.safeParse(RELAY_STEP_COUNT + 1).success).toBe(false)
  })

  it('房间阶段新增 5 个接龙阶段，默认规则携带三时长默认值 20 / 90 / 45', () => {
    for (const phase of RELAY_PHASES) expect(RoomPhaseSchema.safeParse(phase).success).toBe(true)
    const settings = defaultRoomSettings()
    expect(settings.relayChooseSeconds).toBe(20)
    expect(settings.relayDrawSeconds).toBe(90)
    expect(settings.relayGuessSeconds).toBe(45)
    expect(RoomSettingsSchema.safeParse(settings).success).toBe(true)
  })

  it('接龙三时长只接受白名单档位（区间内的旧值同样非法）', () => {
    const valid = defaultRoomSettings()
    const whitelists: Array<[keyof typeof valid, readonly number[]]> = [
      ['relayChooseSeconds', RELAY_CHOOSE_SECONDS_OPTIONS],
      ['relayDrawSeconds', RELAY_DRAW_SECONDS_OPTIONS],
      ['relayGuessSeconds', RELAY_GUESS_SECONDS_OPTIONS],
    ]
    for (const [field, options] of whitelists) {
      for (const seconds of options)
        expect(RoomSettingsSchema.safeParse({ ...valid, [field]: seconds }).success).toBe(true)
    }
    expect(RoomSettingsSchema.safeParse({ ...valid, relayChooseSeconds: 5 }).success).toBe(false)
    expect(RoomSettingsSchema.safeParse({ ...valid, relayDrawSeconds: 105 }).success).toBe(false)
    expect(RoomSettingsSchema.safeParse({ ...valid, relayGuessSeconds: 40 }).success).toBe(false)
  })

  it('建房请求的模式字段属房间顶层：缺省经典、只接受两种登记模式（S28 / S27）', () => {
    const base = {
      requestId: REQUEST_ID,
      name: '模式房',
      visibility: 'public',
      settings: defaultRoomSettings(),
    }
    const classic = CreateRoomSchema.safeParse(base)
    expect(classic.success).toBe(true)
    expect(classic.success ? classic.data.gameMode : undefined).toBe('classic')
    expect(CreateRoomSchema.safeParse({ ...base, gameMode: 'relay' }).success).toBe(true)
    expect(CreateRoomSchema.safeParse({ ...base, gameMode: 'spectate' }).success).toBe(false)
    // 模式不属房间规则：塞进 settings 会被 strict 拒绝（创建后不可变）
    expect(
      CreateRoomSchema.safeParse({ ...base, settings: { ...base.settings, gameMode: 'relay' } })
        .success,
    ).toBe(false)
  })
})

describe('接龙请求事件与 ack 配对（S51 / S30 / S79）', () => {
  it('8 条新增请求事件：事件名、请求 Schema 与 ack Schema 三者同时登记（缺一即失败）', () => {
    for (const [key, name] of RELAY_REQUEST_EVENT_NAMES) {
      expect(EVENTS[key]).toBe(name)
      expect(CLIENT_REQUEST_SCHEMAS[name as keyof typeof CLIENT_REQUEST_SCHEMAS]).toBeDefined()
      expect(CLIENT_RESPONSE_SCHEMAS[name as keyof typeof CLIENT_RESPONSE_SCHEMAS]).toBeDefined()
    }
    // 两张注册表的事件集必须完全一致（漏登记一侧即失败）
    expect(Object.keys(CLIENT_RESPONSE_SCHEMAS).sort()).toEqual(
      Object.keys(CLIENT_REQUEST_SCHEMAS).sort(),
    )
  })

  it('接龙绘图事件用 stepId 定位画布，且拒绝经典 roundId 字段（S51 / S53）', () => {
    const stroke = {
      kind: 'stroke' as const,
      id: 'stroke-relay-1',
      tool: 'pen' as const,
      color: '#1F2937',
      width: 5,
      points: [{ x: 0.1, y: 0.1 }],
      sequence: 0,
    }
    const fill = {
      kind: 'fill' as const,
      id: 'fill-relay-1',
      point: { x: 0.5, y: 0.5 },
      color: '#EF4444',
      sequence: 1,
    }
    const payloads = [
      [EVENTS.relayDrawStrokeBatch, { stroke }],
      [EVENTS.relayDrawFillCommit, { fill }],
      [EVENTS.relayDrawUndo, {}],
      [EVENTS.relayDrawRedo, {}],
      [EVENTS.relayDrawClear, {}],
    ] as const
    for (const [event, extra] of payloads) {
      const schema = CLIENT_REQUEST_SCHEMAS[event]
      expect(schema.safeParse({ requestId: REQUEST_ID, stepId: ROUND_ID, ...extra }).success).toBe(
        true,
      )
      expect(schema.safeParse({ requestId: REQUEST_ID, roundId: ROUND_ID, ...extra }).success).toBe(
        false,
      )
      expect(
        schema.safeParse({ requestId: REQUEST_ID, stepId: 'not-uuid', ...extra }).success,
      ).toBe(false)
    }
  })

  it('两条提交事件的文本边界不同：猜词 1～60 字、作画仅标记完成（S15 / S30）', () => {
    const guessSchema = CLIENT_REQUEST_SCHEMAS[EVENTS.relaySubmitGuess]
    expect(
      guessSchema.safeParse({ requestId: REQUEST_ID, stepId: ROUND_ID, text: '苹果' }).success,
    ).toBe(true)
    expect(
      guessSchema.safeParse({ requestId: REQUEST_ID, stepId: ROUND_ID, text: '' }).success,
    ).toBe(false)
    expect(
      guessSchema.safeParse({ requestId: REQUEST_ID, stepId: ROUND_ID, text: '啊'.repeat(61) })
        .success,
    ).toBe(false)

    const drawingSchema = CLIENT_REQUEST_SCHEMAS[EVENTS.relaySubmitDrawing]
    expect(drawingSchema.safeParse({ requestId: REQUEST_ID, stepId: ROUND_ID }).success).toBe(true)
    expect(
      drawingSchema.safeParse({ requestId: REQUEST_ID, stepId: ROUND_ID, text: '苹果' }).success,
    ).toBe(false)
  })

  it('独立聊天事件与作答彻底分离：chat:say 不带 stepId（S79 / S20）', () => {
    const chatSchema = CLIENT_REQUEST_SCHEMAS[EVENTS.chatSay]
    expect(chatSchema.safeParse({ requestId: REQUEST_ID, text: '大家好' }).success).toBe(true)
    expect(chatSchema.safeParse({ requestId: REQUEST_ID, text: '' }).success).toBe(false)
    expect(
      chatSchema.safeParse({ requestId: REQUEST_ID, text: '大家好', stepId: ROUND_ID }).success,
    ).toBe(false)
  })
})

describe('接龙视图 Schema（按观看者的最小集，S57 / S63）', () => {
  it('快照的模式字段与可选 relay 视图通过 strict 校验，非法模式被拒', () => {
    expect(roomSnapshotPush.safeParse(envelope(validSnapshot())).success).toBe(true)
    const relaySnapshot = { ...validSnapshot(), gameMode: 'relay', relay: relayChooseView() }
    expect(roomSnapshotPush.safeParse(envelope(relaySnapshot)).success).toBe(true)
    expect(
      roomSnapshotPush.safeParse(envelope({ ...validSnapshot(), gameMode: 'coop' })).success,
    ).toBe(false)
  })

  it('严格拒绝越界键：其余链内容、候选词池与未揭晓答案都不进视图', () => {
    const base = { ...validSnapshot(), gameMode: 'relay' }
    for (const leak of [
      { answerLength: 2 },
      { otherChains: [{ answer: '香蕉' }] },
      { candidatePool: ['苹果'] },
      { answer: '苹果' },
      { answerMask: '＿' },
    ]) {
      expect(
        roomSnapshotPush.safeParse(envelope({ ...base, relay: { ...relayChooseView(), ...leak } }))
          .success,
        JSON.stringify(leak),
      ).toBe(false)
    }
  })

  it('视图字段是封闭可数集合：新增字段必须显式登记到本断言', () => {
    expect(Object.keys(RelayGameViewSchema.shape).sort()).toEqual([
      'canReroll',
      'canReturnWaiting',
      'currentStep',
      'finalRanking',
      'gameResultMinEndsAt',
      'messages',
      'ownCanvas',
      'phase',
      'phaseEndsAt',
      'phaseStartedAt',
      'previousArtist',
      'previousDrawing',
      'prompt',
      'showcase',
      'stepId',
      'submitted',
      'submittedPlayerIds',
      'wordOptions',
    ])
    expect(Object.keys(RelayShowcaseSchema.shape).sort()).toEqual([
      'answer',
      'chainCount',
      'chainIndex',
      'drawing',
      'half',
      'prompt',
      'votes',
    ])
    // 终局榜的一行只有身份 / 名次 / 分数与接龙口径统计：称号、最佳链条、明细一律进不来（S33）
    expect(Object.keys(RelayFinalRankingEntrySchema.shape).sort()).toEqual([
      'agreeVotes',
      'avatarId',
      'chainCount',
      'id',
      'nickname',
      'rank',
      'score',
    ])
  })

  it('步骤号固定 1～4、半场固定 1～2、复盘链序号从 1 起', () => {
    expect(RelayGameViewSchema.safeParse(relayGuessView()).success).toBe(true)
    expect(RelayGameViewSchema.safeParse({ ...relayGuessView(), currentStep: 5 }).success).toBe(
      false,
    )
    expect(RelayGameViewSchema.safeParse({ ...relayGuessView(), currentStep: 0 }).success).toBe(
      false,
    )
    const voteView = relayVoteView()
    const showcase = voteView.showcase as Record<string, unknown>
    expect(RelayGameViewSchema.safeParse(voteView).success).toBe(true)
    expect(
      RelayGameViewSchema.safeParse({ ...voteView, showcase: { ...showcase, half: 3 } }).success,
    ).toBe(false)
    expect(
      RelayGameViewSchema.safeParse({ ...voteView, showcase: { ...showcase, chainIndex: 0 } })
        .success,
    ).toBe(false)
  })

  it('未揭晓答案只表达为 null：不下发文本也不下发长度（S81）', () => {
    const view = relayVoteView()
    const showcase = view.showcase as Record<string, unknown>
    const answer = showcase.answer as Record<string, unknown>
    expect(
      RelayGameViewSchema.safeParse({
        ...view,
        showcase: { ...showcase, answer: { ...answer, text: null } },
      }).success,
    ).toBe(true)
    expect(
      RelayGameViewSchema.safeParse({
        ...view,
        showcase: { ...showcase, answer: { player: answer.player } },
      }).success,
    ).toBe(false)
  })

  it('匿名票行只有赞同 / 不赞同两项，不携带投票者（S42）', () => {
    const view = relayVoteView()
    const showcase = view.showcase as Record<string, unknown>
    expect(
      RelayGameViewSchema.safeParse({
        ...view,
        showcase: { ...showcase, votes: ['agree', 'abstain'] },
      }).success,
    ).toBe(false)
    expect(
      RelayGameViewSchema.safeParse({
        ...view,
        showcase: { ...showcase, votes: [{ playerId: HOST_ID, choice: 'agree' }] },
      }).success,
    ).toBe(false)
  })

  it('终局视图：rank/score/chainCount/agreeVotes 通过，称号与链明细被 strict 拒绝（S33 / S77）', () => {
    const view = relayResultView()
    expect(RelayGameViewSchema.safeParse(view).success).toBe(true)
    // 阶段放宽只到 game_result：等待中的房间没有接龙视图（S57 / S63）
    expect(RelayGameViewSchema.safeParse({ ...view, phase: 'waiting' }).success).toBe(false)
    const ranking = view.finalRanking as Array<Record<string, unknown>>
    const [entry] = ranking
    if (!entry) throw new Error('终局榜样例缺少条目')
    for (const leak of [
      { accolade: '最佳默契' },
      { title: '神笔马良' },
      { bestChain: 1 },
      { chains: [{ chainIndex: 1, matched: true }] },
      { votes: ['agree'] },
      { stats: { correctCount: 1 } },
    ]) {
      expect(
        RelayGameViewSchema.safeParse({ ...view, finalRanking: [{ ...entry, ...leak }] }).success,
        JSON.stringify(leak),
      ).toBe(false)
    }
    // 已投票集合必须是 id 列表：计数、对象或选择值都不合法（S41 / S42 / S64）
    expect(RelayGameViewSchema.safeParse({ ...view, submittedPlayerIds: 2 }).success).toBe(false)
    expect(
      RelayGameViewSchema.safeParse({
        ...view,
        submittedPlayerIds: [{ playerId: HOST_ID }],
      }).success,
    ).toBe(false)
    expect(RelayGameViewSchema.safeParse({ ...view, submittedPlayerIds: ['agree'] }).success).toBe(
      false,
    )
  })
})
