/**
 * 原型模拟对局数据（纯 UI 演示，不连后端）。
 *
 * 以真实 DTO 类型构造一局「作画中」的房间快照，让现有组件（GameHud / ScoreStrip /
 * ChatPanel / DrawingToolbar / GameCanvas）在真实形状的数据上渲染；
 * 数据只服务于渲染，不参与任何网络交互。
 */
import type {
  AvatarId,
  ChatMessage,
  DrawPoint,
  DrawingCommand,
  RoomMember,
  RoomSnapshot,
  Stroke,
} from '@draw-guess/shared'

/** 生成稳定且合法的 UUID（原型不引入随机数，刷新后数据一致，便于对比变体）。 */
function mockUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

let uuidCursor = 200
/** 运行期追加的本地消息 ID（从游标续号，保证不与初始数据重复）。 */
export function nextMockUuid(): string {
  uuidCursor += 1
  return mockUuid(uuidCursor)
}

/** 模拟房间中的固定身份。 */
export const MOCK_IDS = {
  room: mockUuid(1),
  game: mockUuid(2),
  round: mockUuid(3),
  drawer: mockUuid(11),
  guesser: mockUuid(12),
  blue: mockUuid(13),
  orange: mockUuid(14),
  spectator: mockUuid(15),
} as const

/** 模拟答案与结构化提示（画家视角可见明文，猜词者只拿到遮罩与已揭示提示）。 */
export const MOCK_ANSWER = '长颈鹿'
export const MOCK_HINT = '草原上的高个子'

function createMember(input: {
  id: string
  nickname: string
  avatarId: AvatarId
  seatIndex: number
  seatColor: string
  score: number
  isDrawer?: boolean
  guessed?: boolean
  spectating?: boolean
  connection?: RoomMember['connection']
  correctCount?: number
  drawingCorrectCount?: number
}): RoomMember {
  return {
    id: input.id,
    nickname: input.nickname,
    avatarId: input.avatarId,
    status: 'playing',
    seatIndex: input.seatIndex,
    seatColor: input.seatColor,
    ready: true,
    score: input.score,
    isHost: input.id === MOCK_IDS.drawer,
    isDrawer: input.isDrawer ?? false,
    guessed: input.guessed ?? false,
    spectating: input.spectating ?? false,
    waitingForNextGame: false,
    rematchReady: false,
    leftGame: false,
    connection: input.connection ?? 'online',
    stats: {
      correctCount: input.correctCount ?? 0,
      totalGuessMs: 0,
      drawingCorrectCount: input.drawingCorrectCount ?? 0,
    },
  }
}

/** 五个成员：画家 / 我（猜词者）/ 已猜中 / 重连中 / 观战——覆盖得分条的各类状态样式。 */
function createMockMembers(): RoomMember[] {
  return [
    createMember({
      id: MOCK_IDS.drawer,
      nickname: '阿画',
      avatarId: '05',
      seatIndex: 0,
      seatColor: '#dc2626',
      score: 240,
      isDrawer: true,
      drawingCorrectCount: 2,
    }),
    createMember({
      id: MOCK_IDS.guesser,
      nickname: '阿猜',
      avatarId: '12',
      seatIndex: 1,
      seatColor: '#facc15',
      score: 180,
      correctCount: 2,
    }),
    createMember({
      id: MOCK_IDS.blue,
      nickname: '小蓝',
      avatarId: '23',
      seatIndex: 2,
      seatColor: '#16a34a',
      score: 120,
      guessed: true,
      correctCount: 1,
    }),
    createMember({
      id: MOCK_IDS.orange,
      nickname: '阿橙',
      avatarId: '31',
      seatIndex: 3,
      seatColor: '#dbeafe',
      score: 90,
      connection: 'reconnecting',
      correctCount: 1,
    }),
    createMember({
      id: MOCK_IDS.spectator,
      nickname: '旁观者',
      avatarId: '38',
      seatIndex: 4,
      seatColor: '#2563eb',
      score: 0,
      spectating: true,
    }),
  ]
}

/** 初始聊天记录：系统 / 普通猜词 / 猜中 / 预设短语，覆盖聊天面板的全部消息样式。 */
function createMockMessages(): ChatMessage[] {
  const base = Date.now() - 90_000
  return [
    {
      id: mockUuid(21),
      type: 'system',
      text: '第 2 回合开始，轮到「阿画」作画',
      createdAt: base,
    },
    {
      id: mockUuid(22),
      type: 'guess',
      text: '是动物吗？',
      playerId: MOCK_IDS.blue,
      createdAt: base + 5_000,
    },
    {
      id: mockUuid(23),
      type: 'guess',
      text: '我猜是长颈鹿！',
      playerId: MOCK_IDS.orange,
      createdAt: base + 11_000,
    },
    {
      id: mockUuid(24),
      type: 'correct',
      text: '猜中了答案！+92 分',
      playerId: MOCK_IDS.blue,
      createdAt: base + 14_000,
    },
    {
      id: mockUuid(25),
      type: 'preset',
      text: '画得真棒！',
      playerId: MOCK_IDS.orange,
      createdAt: base + 20_000,
    },
    {
      id: mockUuid(26),
      type: 'system',
      text: '结构化提示已揭示：草原上的高个子',
      createdAt: base + 30_000,
    },
  ]
}

/**
 * 构造模拟房间快照。
 * `viewerIsDrawer` 控制答案字段是否下发——与真实快照的角色裁剪口径一致
 * （画家拿到 answer/wordHint 明文，猜词者只有遮罩与已揭示提示）。
 */
export function createMockRoom(options: { viewerIsDrawer: boolean }): RoomSnapshot {
  const now = Date.now()
  return {
    id: MOCK_IDS.room,
    name: '原型演示房',
    hostId: MOCK_IDS.drawer,
    visibility: 'public',
    phase: 'drawing',
    stateVersion: 42,
    settings: {
      maxPlayers: 6,
      roundsPerPlayer: 3,
      drawSeconds: 80,
      chooseSeconds: 15,
      optionCount: 3,
      showWordLength: true,
      progressiveHints: true,
      structuredHintsEnabled: true,
      hintStartRatio: 0.6,
      guessBaseScore: 100,
      extraGuessSeconds: 0,
      allowPlayerInvite: true,
      allowPause: true,
      allowWordReroll: true,
      joinPolicy: 'forbid',
    },
    members: createMockMembers(),
    selectedWordCount: 1_200,
    totalWordCount: 3_000,
    vocabularyPackageName: '基础词库',
    game: {
      gameId: MOCK_IDS.game,
      roundId: MOCK_IDS.round,
      currentRound: 2,
      totalRounds: 3,
      drawerId: MOCK_IDS.drawer,
      // 已进行 55 秒 / 共 80 秒：过了提示揭示点，遮罩已亮出一个字，倒计时约剩 25 秒
      phaseStartedAt: now - 55_000,
      phaseEndsAt: now + 25_000,
      answerMask: '长＿＿',
      ...(options.viewerIsDrawer ? { answer: MOCK_ANSWER, wordHint: MOCK_HINT } : {}),
      revealedHints: [MOCK_HINT],
      // 画布历史由原型本地维护（prototype-drawing.ts），这里保持空数组
      strokes: [],
      undoneStrokeIds: [],
      lastSequence: 0,
      drawingRevision: 1,
      messages: createMockMessages(),
    },
  }
}

/** 生成一段圆形折线（太阳等）。 */
function circlePoints(
  centerX: number,
  centerY: number,
  radius: number,
  count: number,
): DrawPoint[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (index / count) * Math.PI * 2
    return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius }
  })
}

/** 生成一段带轻微起伏的横向折线（草地等）。 */
function wavePoints(centerY: number, count: number): DrawPoint[] {
  return Array.from({ length: count + 1 }, (_, index) => ({
    x: 0.06 + (index / count) * 0.88,
    y: centerY + Math.sin(index / 2.2) * 0.012,
  }))
}

function mockStroke(input: {
  id: string
  color: string
  width: number
  points: DrawPoint[]
  sequence: number
}): Stroke {
  return {
    kind: 'stroke',
    id: input.id,
    tool: 'pen',
    color: input.color,
    width: input.width,
    points: input.points,
    startPointIndex: 0,
    sequence: input.sequence,
  }
}

/** 初始画布历史：太阳 + 草地 + 小树，让原型一打开就有画面，且可直接继续绘制。 */
export function createInitialCommands(): DrawingCommand[] {
  return [
    mockStroke({
      id: mockUuid(31),
      color: '#F97316',
      width: 5,
      points: circlePoints(0.16, 0.18, 0.06, 18),
      sequence: 1,
    }),
    mockStroke({
      id: mockUuid(32),
      color: '#22C55E',
      width: 6,
      points: wavePoints(0.82, 26),
      sequence: 2,
    }),
    mockStroke({
      id: mockUuid(33),
      color: '#1F2937',
      width: 6,
      points: [
        { x: 0.72, y: 0.79 },
        { x: 0.72, y: 0.52 },
      ],
      sequence: 3,
    }),
    mockStroke({
      id: mockUuid(34),
      color: '#22C55E',
      width: 5,
      points: [
        { x: 0.6, y: 0.56 },
        { x: 0.72, y: 0.32 },
        { x: 0.84, y: 0.56 },
        { x: 0.6, y: 0.56 },
      ],
      sequence: 4,
    }),
  ]
}
