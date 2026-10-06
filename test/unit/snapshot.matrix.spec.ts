import { describe, expect, it } from 'vitest'
import { RoomSnapshotSchema, type RoomPhase } from '@draw-guess/shared'
import { SnapshotBuilder, type SnapshotViewPort } from '../../apps/server/src/snapshot.ts'
import type {
  GameSecret,
  MemberState,
  PlayerSecret,
  RoomSecret,
} from '../../apps/server/src/models.ts'
import { GameError } from '../../apps/server/src/errors.ts'
import { createRelayChainSecret } from '../../apps/server/src/domain/relay/relay-models.ts'
import type { RelayShowcaseCursor } from '../../apps/server/src/domain/relay/relay-showcase.ts'
import { createMemoryVocabularyRegistry } from './helpers/mini-vocabulary.ts'
import { testRoomSettings } from './helpers/game-harness.ts'

/**
 * 角色裁剪快照的穷举回归矩阵（ADR-0021）。
 *
 * SnapshotBuilder 收窄为 SnapshotViewPort 后可脱离 GameService 直接实例化：
 * 观看者角色 × 房间阶段 全笛卡尔积逐格断言「三重守卫」——
 * ① RoomSnapshotSchema（strict）safeParse 必过：任何 Secret 字段混入即现形；
 * ② 序列化不含秘密字段名全清单 + 哨兵值（秘密字段的 value 也绝不允许换键位出现）；
 * ③ 授权字段可见性真值表：answer / wordOptions / privateJoinCode / canReturnWaiting
 *    按「该格是否应见」断言存在性——欠曝（画家看不到）与越权（观众看得到）同罪。
 * 秘密 fixture 全部带 SENTINEL 前缀：泄漏时错误信息直接指出是哪个字段。
 */

const NOW = 1_700_000_000_000
const HOST_ID = '00000000-0000-4000-8000-0000000000a1'
const DRAWER_ID = '00000000-0000-4000-8000-0000000000b2'
const GUESSER_ID = '00000000-0000-4000-8000-0000000000c3'
const LEFT_GAME_ID = '00000000-0000-4000-8000-0000000000f6'
/** 在房里但没有分到链的公开房成员（接龙矩阵的越权格）。 */
const UNSEATED_ID = '00000000-0000-4000-8000-0000000000e5'
const ROOM_ID = '00000000-0000-4000-8000-000000000101'
const GAME_ID = '00000000-0000-4000-8000-000000000202'
const ROUND_ID = '00000000-0000-4000-8000-000000000303'
const PRIVATE_CODE = 'SENITNEL-CODE'

/** 任何观看者的任何快照都绝不允许出现的 JSON 键（服务端内部簿记/秘密/计时器）。 */
const FORBIDDEN_KEYS = [
  // PlayerSecret 内部
  'tokenDigest',
  'preferences',
  'socketId',
  'joinedAt',
  'disconnectedAt',
  'drawingDisconnectRoomId',
  'disconnectGeneration',
  'disconnectTimer',
  'requestCache',
  'lastInviteAt',
  'guessEventTimes',
  'drawEventTimes',
  'privateJoinAttemptTimes',
  // MemberState 内部（公开视图只保留显式挑选的字段）
  'leftProfile',
  'guessedAt',
  'lastSyncedSeq',
  // RoomSecret 内部
  'selectedWordIds',
  // GameSecret 内部
  'startedAt',
  'roundDurationMs',
  'drawerOrder',
  'candidates',
  'rerollUsed',
  'offeredWordIds',
  'strokePointTotal',
  'fillCount',
  'correctOrder',
  'correctDetails',
  // RelayGameSecret / RelayChainSecret 内部（工单 05）：接龙视图只经 relay 字段裁剪下发，
  // 链数组、两幅画布、四棒产出与本步提交集都不允许按任何键位出现在快照里。
  'chains',
  'originPlayerId',
  'step1Canvas',
  'step3Canvas',
  'step1Word',
  'step2Guess',
  'step4Guess',
  'stepSubmissions',
  'autoSubmitTimers',
  // 注：`currentStep` / `stepId` / `phaseStartedAt` / `phaseEndsAt` / `messages` / `votes`(复盘票行)
  // 是接龙视图的**合法**字段，不能进禁止清单（禁止清单只收「任何观看者都不该看到」的簿记）。
  // 复盘期的 `showcase` 子树同理合法（工单 07）：`chainIndex` / `chainCount` / `half` / `prompt` /
  // `answer` / `drawing` 都是按游标裁剪后的公开内容（只含当前链），未揭晓的答案表现为
  // `answer.text === null`（既无文本也无长度，S32 / S63 / S81）。
  // 逐字遮罩已揭示字符下标是服务端秘密簿记；公开视图只经 answerMask 表达，
  // 键与值都不得进快照（结构化提示已移除，见 docs/adr/0042-remove-structured-hints.md）。
  'revealedIndices',
  'hostReturnRequested',
  'timer',
  'rematchTimer',
  'hintTimers',
]

function makePlayer(playerId: string, nickname: string): PlayerSecret {
  return {
    id: playerId,
    tokenDigest: `SENTINEL-digest-${nickname}`,
    profile: { nickname, avatarId: '01' },
    preferences: { discoverable: true, acceptsInvites: true },
    socketId: `SENTINEL-socket-${nickname}`,
    roomId: ROOM_ID,
    connected: true,
    joinedAt: NOW - 10_000,
    disconnectedAt: NOW - 5_000,
    drawingDisconnectRoomId: 'SENTINEL-drawing-disconnect',
    disconnectGeneration: 3,
    requestCache: new Map(),
    lastInviteAt: new Map(),
    guessEventTimes: [],
    drawEventTimes: [],
    privateJoinAttemptTimes: [],
  }
}

function makeMember(
  playerId: string,
  seatIndex: number,
  patch: Partial<MemberState> = {},
): MemberState {
  return {
    playerId,
    seatIndex,
    ready: true,
    score: 120,
    joinedAt: NOW - 60_000,
    guessedAt: NOW - 10_000,
    stats: { correctCount: 2, totalGuessMs: 4_000, drawingCorrectCount: 1 },
    ...patch,
  }
}

/** 对局阶段（含无对局的 waiting）；closed 房间已从房间表移除，不属于快照输入域。 */
const PHASES: RoomPhase[] = [
  'waiting',
  'starting',
  'choosing_word',
  'drawing',
  'round_result',
  'game_result',
]

/** 观看者在其所在格子中的身份标签。 */
type ViewerRole = 'drawer-host' | 'drawer' | 'guesser' | 'host-not-drawer' | 'left-game'

function makeGame(phase: RoomPhase, drawerId: string): GameSecret {
  const registry = createMemoryVocabularyRegistry()
  const candidates = registry.items.slice(0, 3)
  const answer = candidates[0]
  const settled = phase === 'round_result' || phase === 'game_result'
  const game: GameSecret = {
    id: GAME_ID,
    startedAt: NOW - 90_000,
    roundId: ROUND_ID,
    phaseStartedAt: NOW - 30_000,
    phaseEndsAt: NOW + 30_000,
    currentRound: 1,
    totalRounds: 4,
    roundDurationMs: 120_000,
    drawerOrder: [drawerId, GUESSER_ID],
    drawerId,
    candidates,
    rerollUsed: false,
    answer,
    offeredWordIds: new Set(candidates.map((word) => word.id)),
    strokes: [],
    undoneStrokeIds: [],
    lastSequence: 2,
    strokePointTotal: 24,
    fillCount: 1,
    messages: [
      {
        id: '00000000-0000-4000-8000-000000000404',
        type: 'guess',
        // 聊天消息是合法公开内容：不得含 SENTINEL（否则 ② 哨兵值检查误报）。
        text: '猜对啦',
        playerId: GUESSER_ID,
        createdAt: NOW - 5_000,
      },
    ],
    correctOrder: [GUESSER_ID],
    correctDetails: [],
    revealedIndices: new Set([1]),
    drawingRevision: 2,
    // 结算阶段补全结算数据，覆盖更多裁剪分支
    ...(settled
      ? {
          roundResult: { answer: answer?.text ?? '', details: [], drawerScore: 80 },
          correctDetails: [{ playerId: GUESSER_ID, order: 1, total: 100 }],
        }
      : {}),
    ...(phase === 'game_result'
      ? {
          finalRanking: [
            {
              id: GUESSER_ID,
              nickname: '猜词者',
              avatarId: '01' as const,
              rank: 1,
              score: 300,
              stats: { correctCount: 3, totalGuessMs: 9_000, drawingCorrectCount: 0 },
            },
          ],
          gameResultMinEndsAt: NOW + 1_000,
        }
      : {}),
  }
  return game
}

interface MatrixCase {
  role: ViewerRole
  viewerId: string
}

const VIEWERS: MatrixCase[] = [
  { role: 'drawer-host', viewerId: DRAWER_ID }, // 房主兼画家
  { role: 'drawer', viewerId: GUESSER_ID }, // 画家（非房主）
  { role: 'guesser', viewerId: HOST_ID }, // 普通猜词者（此格是房主；房主身份不影响猜词裁剪）
  { role: 'host-not-drawer', viewerId: HOST_ID }, // 房主非画家（与上格同数据不同断言轴：privateJoinCode）
  { role: 'left-game', viewerId: LEFT_GAME_ID },
]

/**
 * 组装一个房间：画家固定为 drawerId，成员覆盖房主 / 画家 / 已离局三类身份；
 * 每个格子重建 fixture，避免跨用例串状态。
 */
function makeRoom(
  phase: RoomPhase,
  drawerId: string,
  options: { visibility?: 'public' | 'private' } = {},
): { room: RoomSecret; players: Map<string, PlayerSecret> } {
  const game = phase === 'waiting' ? undefined : makeGame(phase, drawerId)
  const rawMembers: MemberState[] = [
    makeMember(HOST_ID, 0),
    makeMember(drawerId, 1),
    // 已离局成员：无 player 身份也能渲染（leftProfile 兜底路径）
    {
      ...makeMember(LEFT_GAME_ID, 2, { leftGame: true }),
      leftProfile: { nickname: '已离局', avatarId: '02' },
    },
  ]
  // drawerId 恰为房主时会产生重复 playerId：后写覆盖，保留带画家角色的席位（drawer-host 格）。
  const deduped = new Map<string, MemberState>()
  for (const member of rawMembers) deduped.set(member.playerId, member)
  const members = [...deduped.values()]
  const players = new Map<string, PlayerSecret>()
  for (const member of members) {
    // 已离局成员故意不注册玩家身份：驱动 leftProfile 兜底分支
    if (member.playerId === LEFT_GAME_ID) continue
    players.set(member.playerId, makePlayer(member.playerId, `玩家-${member.playerId.slice(-2)}`))
  }
  const room: RoomSecret = {
    id: ROOM_ID,
    name: '矩阵房间',
    hostId: HOST_ID,
    visibility: options.visibility ?? 'public',
    // 矩阵主体是经典阶段：接龙维度由工单 04 起在快照矩阵中扩展
    gameMode: 'classic',
    privateJoinCode: options.visibility === 'private' ? PRIVATE_CODE : undefined,
    phase,
    stateVersion: 7,
    vocabularyPackageIds: ['base_words'],
    settings: testRoomSettings({ showWordLength: true }),
    members,
    selectedWordIds: new Set(['word-1', 'word-2', 'word-3']),
    ...(game ? { game } : {}),
  }
  return { room, players }
}

function makePort(
  players: Map<string, PlayerSecret>,
  room: RoomSecret,
  now = NOW,
): SnapshotViewPort {
  return {
    players,
    rooms: new Map([[room.id, room]]),
    clock: { now: () => now },
    // 与生产实现（phase-facts 的 isInMatchPhase）一致：经典四个阶段都算对局进行中
    isPlaying: (phase) => ['starting', 'choosing_word', 'drawing', 'round_result'].includes(phase),
    getRoomVocabularyStore: () => createMemoryVocabularyRegistry().getDefault(),
    requirePlayer: (playerId) => {
      const player = players.get(playerId)
      if (!player) throw new GameError('UNAUTHORIZED', 'requirePlayer')
      return player
    },
  }
}

/** 观看者角色 → 玩家 id（画家格会动态换人）。 */
function viewerIdFor(role: ViewerRole, drawerId: string): string {
  switch (role) {
    case 'drawer-host':
    case 'host-not-drawer':
      return HOST_ID
    case 'drawer':
      return drawerId
    case 'guesser':
      return HOST_ID
    case 'left-game':
      return LEFT_GAME_ID
  }
}

/** 该格「画家」应是谁：drawer-host 格房主即画家；其余格默认房主猜词。 */
function drawerFor(role: ViewerRole): string {
  return role === 'drawer-host' || role === 'guesser' ? GUESSER_ID : DRAWER_ID
}

describe('角色裁剪快照穷举矩阵', () => {
  const ROLES: ViewerRole[] = VIEWERS.map((viewer) => viewer.role)
  for (const role of ROLES) {
    for (const phase of PHASES) {
      const drawerId = drawerFor(role)
      // 同格双身份：drawer-host 让房主兼画家，其余格房主只猜词
      const roomDrawerId = role === 'drawer-host' ? HOST_ID : drawerId
      const viewerId = viewerIdFor(role, roomDrawerId)
      it(`${phase} 阶段 × ${role}：三重守卫全部成立`, () => {
        const { room, players } = makeRoom(phase, roomDrawerId)
        const builder = new SnapshotBuilder(makePort(players, room))

        const snapshot = builder.snapshot(room, viewerId)

        // ① strict 运行时闸门：任何 Secret 字段混入即现形
        const parsed = RoomSnapshotSchema.safeParse(snapshot)
        expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true)

        const serialized = JSON.stringify(snapshot)
        // ② 秘密键名全清单 + 哨兵值（换键位泄漏也会被抓）
        for (const key of FORBIDDEN_KEYS) {
          expect(serialized, `泄漏键 ${key}`).not.toContain(`"${key}"`)
        }
        expect(serialized).not.toContain('SENTINEL-')

        // ③ 授权字段可见性真值表
        if (phase === 'waiting') {
          expect(snapshot.game).toBeUndefined()
          return
        }
        const gameView = snapshot.game
        expect(gameView).toBeDefined()
        // 画家本人（房主与否无关）在任何阶段都收 answer 真值；
        // 已离局身份即使 ID 碰巧等于 drawerId 也不算画家（isActivePlayer 排除离局者）。
        const isViewerDrawer =
          (role === 'drawer' || role === 'drawer-host') && viewerId === roomDrawerId
        // 答案明文只发给画家本人（所有对局阶段一致）；猜词者只有逐字遮罩
        if (isViewerDrawer) {
          expect(gameView?.answer).toBe(room.game?.answer?.text)
        } else {
          expect(gameView?.answer).toBeUndefined()
        }
        // 选词选项仅画家本人在 choosing_word 可见
        if (isViewerDrawer && phase === 'choosing_word') {
          expect(gameView?.wordOptions?.length).toBe(room.game?.candidates.length)
        } else {
          expect(gameView?.wordOptions).toBeUndefined()
        }
        // 结算遮罩即全文；作画阶段非画家只见遮罩不见真值
        if (phase === 'round_result' && !isViewerDrawer)
          expect(gameView?.answerMask).toBe(room.game?.answer?.text)
        if (phase === 'drawing' && !isViewerDrawer)
          expect(gameView?.answerMask).not.toBe(room.game?.answer?.text)
      })
    }
  }

  describe('私密房与时间轴专项', () => {
    it('私密房码只进当前房主的快照，普通成员拿不到', () => {
      const { room, players } = makeRoom('drawing', DRAWER_ID, { visibility: 'private' })
      const builder = new SnapshotBuilder(makePort(players, room))

      expect(builder.snapshot(room, HOST_ID).privateJoinCode).toBe(PRIVATE_CODE)
      expect(builder.snapshot(room, DRAWER_ID).privateJoinCode).toBeUndefined()
      expect(builder.snapshot(room, LEFT_GAME_ID).privateJoinCode).toBeUndefined()
    })

    it('逐字遮罩只经 answerMask 下发，已揭示字符下标簿记不出现在序列化结果中', () => {
      const { room, players } = makeRoom('drawing', DRAWER_ID)
      const game = room.game!
      game.revealedIndices = new Set([1, 3])
      const builder = new SnapshotBuilder(makePort(players, room))

      const snapshot = builder.snapshot(room, HOST_ID)
      // 遮罩是唯一公开表达：未猜中玩家看到部分揭示的字符
      expect(snapshot.game?.answerMask).toBeDefined()
      expect(snapshot.game?.answerMask).not.toBe(game.answer?.text)
      // 内部下标集合是秘密簿记，任何键位都不得泄漏
      expect(JSON.stringify(snapshot)).not.toContain('"revealedIndices"')
    })

    it('canReturnWaiting 需要「房主 + game_result + 最短展示期已过」同时成立', () => {
      const { room, players } = makeRoom('game_result', DRAWER_ID)
      const minEndsAt = room.game?.gameResultMinEndsAt ?? 0
      const builderEarly = new SnapshotBuilder(makePort(players, room, minEndsAt - 1))
      const builderLate = new SnapshotBuilder(makePort(players, room, minEndsAt))

      expect(builderEarly.snapshot(room, HOST_ID).game?.canReturnWaiting).toBe(false)
      expect(builderLate.snapshot(room, HOST_ID).game?.canReturnWaiting).toBe(true)
      // game_result 全员下发该键（客户端渲染倒计时归零提示）；非房主永不为 true。
      expect(builderLate.snapshot(room, DRAWER_ID).game?.canReturnWaiting).toBe(false)
    })

    it('lastSyncedSeq 追平时画布历史以 strokesOmitted 省略，落后/离线成员收全量', () => {
      const { room, players } = makeRoom('drawing', DRAWER_ID)
      const roomWithStrokes = structuredClone(room)
      const strokes = [
        {
          kind: 'stroke' as const,
          id: 'stroke-1',
          tool: 'pen' as const,
          color: '#1F2937',
          width: 4,
          points: [{ x: 0.1, y: 0.1 }],
          sequence: 1,
          startPointIndex: 0,
        },
      ]
      roomWithStrokes.game!.strokes = strokes
      const syncedMember = roomWithStrokes.members.find((m) => m.playerId === HOST_ID)!
      syncedMember.lastSyncedSeq = roomWithStrokes.game!.lastSequence
      // 离线防御格：追平但身份不在线——仍必须收全量（省略的前提是「确实在同步」）。
      const offlineId = '00000000-0000-4000-8000-0000000000e5'
      const offlineMember = makeMember(offlineId, 3)
      offlineMember.lastSyncedSeq = roomWithStrokes.game!.lastSequence
      roomWithStrokes.members.push(offlineMember)
      players.set(offlineId, makePlayer(offlineId, '离线成员'))
      players.get(offlineId)!.connected = false

      const builder = new SnapshotBuilder(makePort(players, roomWithStrokes))
      const synced = builder.snapshot(roomWithStrokes, HOST_ID)
      const behind = builder.snapshot(roomWithStrokes, DRAWER_ID)
      const offline = builder.snapshot(roomWithStrokes, offlineId)

      expect(synced.game?.strokes).toEqual([])
      expect(synced.game?.strokesOmitted).toBe(true)
      expect(behind.game?.strokes).toEqual(strokes)
      expect(behind.game?.strokesOmitted).toBeUndefined()
      expect(offline.game?.strokes).toEqual(strokes)
      expect(offline.game?.strokesOmitted).toBeUndefined()
    })

    it('非成员观看者被拒绝且不泄漏房间字段', () => {
      const { room, players } = makeRoom('drawing', DRAWER_ID)
      const builder = new SnapshotBuilder(makePort(players, room))
      expect(() => builder.snapshot(room, '00000000-0000-4000-8000-000000000999')).toThrow(
        GameError,
      )
    })
  })

  /**
   * 接龙维度（工单 05）：角色 × 接龙阶段 × 步骤 × 链归属。
   * 与「接龙视图裁剪矩阵」（relay-view.spec.ts）分工：这里走**整份快照**，
   * 因此额外把关 ① `RoomSnapshotSchema` strict 闸门、② 禁止键清单（含接龙秘密键）、
   * ③ 成员视角下的 `game` / `relay` 互斥与「不在本局链阵容」的降级路径。
   */
  describe('接龙维度（角色 × 阶段 × 步骤 × 链归属）', () => {
    const RELAY_STEP_ID = '00000000-0000-4000-8000-000000000303'
    /** 链发起人按席位顺序：4 名成员各占一条链（已离局成员仍占链位，S37）。 */
    const CHAIN_ORIGINS = [HOST_ID, DRAWER_ID, GUESSER_ID, LEFT_GAME_ID]
    const relayWordText = (chain: number) => `SENTINEL-接龙题面-${chain}`
    const relayGuessText = (chain: number) => `SENTINEL-接龙猜词-${chain}`
    const relayLastGuessText = (chain: number) => `SENTINEL-接龙末答-${chain}`
    const relayCandidateText = (chain: number) => `SENTINEL-接龙候选-${chain}`
    const relayStrokeId = (chain: number, half: 1 | 3) => `SENTINEL-接龙笔画-${chain}-${half}`
    const RELAY_SENTINELS = CHAIN_ORIGINS.flatMap((_origin, chain) => [
      relayWordText(chain),
      relayGuessText(chain),
      relayLastGuessText(chain),
      relayCandidateText(chain),
      relayStrokeId(chain, 1),
      relayStrokeId(chain, 3),
    ])
    /** 格子：接龙阶段 × 步骤；复盘期额外带游标（链序号 / 半场 / 页，工单 07）。 */
    const RELAY_CELLS: {
      phase: RoomPhase
      step: 1 | 2 | 3 | 4
      cursor?: RelayShowcaseCursor
    }[] = [
      { phase: 'relay_choose', step: 1 },
      { phase: 'relay_draw', step: 1 },
      { phase: 'relay_draw', step: 3 },
      { phase: 'relay_guess', step: 2 },
      { phase: 'relay_guess', step: 4 },
      // 游标缺失的残缺现场：只给阶段骨架（fail-safe 不泄漏）
      { phase: 'relay_showcase', step: 4 },
      { phase: 'relay_showcase', step: 4, cursor: { chainIndex: 2, half: 1, page: 'replay' } },
      { phase: 'relay_showcase', step: 4, cursor: { chainIndex: 2, half: 1, page: 'reveal' } },
      { phase: 'relay_showcase', step: 4, cursor: { chainIndex: 3, half: 2, page: 'pause' } },
      { phase: 'relay_vote', step: 4, cursor: { chainIndex: 4, half: 2, page: 'reveal' } },
      // 终局：只有排名与统计值得下发，链内容一条都不在（游标虽在状态里，也不该出现在快照里）
      { phase: 'game_result', step: 4, cursor: { chainIndex: 4, half: 2, page: 'reveal' } },
    ]

    /** 链 j 的两幅画布各一笔哨兵笔画 + 题面与步 2 文本都是哨兵值。 */
    function makeRelayChain(chainIndex: number) {
      const chain = createRelayChainSecret(CHAIN_ORIGINS[chainIndex] ?? HOST_ID)
      chain.candidates = [
        {
          id: `word-c${chainIndex}`,
          text: relayCandidateText(chainIndex),
          aliases: [],
          collection: '物品',
          packageId: 'base_words',
          packageName: '基础词库',
        },
      ]
      chain.offeredWordIds.add(`word-c${chainIndex}`)
      chain.step1Word = {
        id: `word-c${chainIndex}`,
        text: relayWordText(chainIndex),
        aliases: [],
        collection: '物品',
        packageId: 'base_words',
        packageName: '基础词库',
      }
      chain.step2Guess = relayGuessText(chainIndex)
      chain.step4Guess = relayLastGuessText(chainIndex)
      chain.step1Canvas.strokes = [
        {
          kind: 'stroke',
          id: relayStrokeId(chainIndex, 1),
          tool: 'pen',
          color: '#1F2937',
          width: 5,
          sequence: 0,
          startPointIndex: 0,
          points: [{ x: 0.2, y: 0.2 }],
        },
      ]
      chain.step3Canvas.strokes = [
        {
          kind: 'stroke',
          id: relayStrokeId(chainIndex, 3),
          tool: 'pen',
          color: '#1F2937',
          width: 5,
          sequence: 0,
          startPointIndex: 0,
          points: [{ x: 0.4, y: 0.4 }],
        },
      ]
      return chain
    }

    /** 组装接龙房：4 条链 + 一个不在链阵容中的残留成员 + 只有第一条链有产出的阶段现场。 */
    function makeRelayRoom(phase: RoomPhase, step: 1 | 2 | 3 | 4, cursor?: RelayShowcaseCursor) {
      const players = new Map<string, PlayerSecret>()
      const members: MemberState[] = []
      for (const [index, playerId] of CHAIN_ORIGINS.entries()) {
        // 已离局成员故意不注册玩家身份：驱动冻结资料兜底分支
        if (playerId !== LEFT_GAME_ID)
          players.set(playerId, makePlayer(playerId, `接龙${index + 1}`))
        members.push(
          playerId === LEFT_GAME_ID
            ? {
                ...makeMember(playerId, index, { leftGame: true }),
                leftProfile: { nickname: '离局链主', avatarId: '02' },
              }
            : makeMember(playerId, index),
        )
      }
      players.set(UNSEATED_ID, makePlayer(UNSEATED_ID, '残留连接'))
      members.push(makeMember(UNSEATED_ID, 4))
      const room: RoomSecret = {
        id: ROOM_ID,
        name: '接龙矩阵房间',
        hostId: HOST_ID,
        visibility: 'public',
        gameMode: 'relay',
        phase,
        stateVersion: 11,
        settings: testRoomSettings(),
        members,
        vocabularyPackageIds: ['base_words'],
        selectedWordIds: new Set(['word-c0', 'word-c1', 'word-c2', 'word-c3']),
        relay: {
          id: GAME_ID,
          startedAt: NOW - 30_000,
          currentStep: step,
          stepId: RELAY_STEP_ID,
          phaseStartedAt: NOW - 5_000,
          phaseEndsAt: NOW + 5_000,
          ...(cursor ? { showcase: cursor } : {}),
          chains: CHAIN_ORIGINS.map((_origin, chain) => makeRelayChain(chain)),
          stepSubmissions: new Set([HOST_ID]),
          messages: [
            {
              id: '00000000-0000-4000-8000-000000000404',
              type: 'system',
              // 聊天 / 通知是合法公开内容：不含哨兵值，否则 ② 的哨兵扫描会误报
              text: '接龙开始',
              createdAt: NOW - 1_000,
            },
          ],
        },
      }
      // 投票期：游标所在链上先落两张真票（房主赞同、猜词者反对）——票行与「已投票」集合
      // 都从链上的票箱派生（S41 / S42 / S64），与动手期的本步提交集是两套记录。
      if (phase === 'relay_vote' && cursor) {
        const chain = room.relay?.chains[cursor.chainIndex - 1]
        if (!chain) throw new Error('投票格缺少游标指向的链')
        chain.votes.push(
          { playerId: HOST_ID, choice: 'agree' },
          { playerId: GUESSER_ID, choice: 'disagree' },
        )
      }
      // 终局：榜单一经冻结即只读；这里给出一行真实形状（链内容仍留在秘密里，由哨兵扫描证明不下发）
      if (phase === 'game_result' && room.relay) {
        room.relay.finalRanking = [
          {
            id: HOST_ID,
            nickname: '接龙1',
            avatarId: '01',
            rank: 1,
            score: 120,
            chainCount: 4,
            agreeVotes: 9,
          },
        ]
        room.relay.gameResultMinEndsAt = NOW + 5_000
      }
      return { room, players }
    }
    /** 测试侧独立算式：观看者 i 在第 s 棒动手的链 = (i - s + 1) mod N。 */
    function chainForViewer(viewerIndex: number, step: number): number {
      return (viewerIndex - (step - 1) + CHAIN_ORIGINS.length) % CHAIN_ORIGINS.length
    }

    /** 该格允许出现的哨兵值：只有「观看者本棒」的那部分链内容（复盘期＝游标指向的那条链）。 */
    function allowedSentinels(
      phase: RoomPhase,
      step: number,
      viewerIndex: number,
      cursor?: RelayShowcaseCursor,
    ): string[] {
      const chain = chainForViewer(viewerIndex, step)
      if (phase === 'relay_choose') return [relayCandidateText(chain)]
      if (phase === 'relay_draw')
        return step === 1
          ? [relayWordText(chain), relayStrokeId(chain, 1)]
          : [relayGuessText(chain), relayStrokeId(chain, 3)]
      if (phase === 'relay_guess') return [relayStrokeId(chain, step === 2 ? 1 : 3)]
      // 终局：排名与统计之外没有任何链内容
      if (phase === 'game_result') return []
      // 复盘期：只公开游标指向的那条链的本半场；未揭晓的答案（重播 / 停顿页）不在允许清单里
      if (!cursor) return []
      const showcaseChain = cursor.chainIndex - 1
      // 投票期：左胶囊是该链**初始词**（S44），右胶囊恒为第四棒答案——step2Guess 不再下发。
      if (phase === 'relay_vote')
        return [
          relayWordText(showcaseChain),
          relayStrokeId(showcaseChain, cursor.half === 1 ? 1 : 3),
          relayLastGuessText(showcaseChain),
        ]
      return [
        cursor.half === 1 ? relayWordText(showcaseChain) : relayGuessText(showcaseChain),
        relayStrokeId(showcaseChain, cursor.half === 1 ? 1 : 3),
        ...(cursor.page === 'reveal'
          ? [cursor.half === 1 ? relayGuessText(showcaseChain) : relayLastGuessText(showcaseChain)]
          : []),
      ]
    }

    for (const cell of RELAY_CELLS) {
      for (const [viewerIndex, viewerId] of CHAIN_ORIGINS.entries()) {
        it(`${cell.phase}（第 ${cell.step} 棒）× 观看者 ${viewerIndex + 1}：三重守卫全部成立`, () => {
          const { room, players } = makeRelayRoom(cell.phase, cell.step, cell.cursor)
          const builder = new SnapshotBuilder(makePort(players, room))

          const snapshot = builder.snapshot(room, viewerId)

          // ① strict 运行时闸门
          const parsed = RoomSnapshotSchema.safeParse(snapshot)
          expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(
            true,
          )
          // 接龙房间只下发 relay，不下发经典 game（两字段由 gameMode 保证恰一个非空，S56）
          expect(snapshot.game).toBeUndefined()
          expect(snapshot.relay?.phase).toBe(cell.phase)
          expect(snapshot.relay?.currentStep).toBe(cell.step)
          // 已动作集合（S41 / S64）：动手期＝本步已提交者、投票期＝该链已投票者；只有 id、无选择与计数
          const actors = cell.phase === 'relay_vote' ? [HOST_ID, GUESSER_ID] : [HOST_ID]
          expect(snapshot.relay?.submittedPlayerIds).toEqual(actors)
          expect(snapshot.relay?.submitted).toBe(actors.includes(viewerId))
          // 票行只在投票期出现：纯选择列表（匿名，S42），且载荷里不存在「谁投了什么」的归属结构
          expect(snapshot.relay?.showcase?.votes).toEqual(
            cell.phase === 'relay_vote' ? ['agree', 'disagree'] : undefined,
          )
          if (cell.phase === 'game_result') {
            // 终局：只有排名 / 分数 / 接龙统计 + 退出时限，链内容（含游标）一条都不在
            expect(snapshot.relay?.showcase).toBeUndefined()
            expect(snapshot.relay?.finalRanking?.[0]).toMatchObject({
              rank: 1,
              score: 120,
              chainCount: 4,
              agreeVotes: 9,
            })
            expect(snapshot.relay?.gameResultMinEndsAt).toBe(NOW + 5_000)
            expect(snapshot.relay?.canReturnWaiting).toBe(false)
          }
          if (cell.cursor && cell.phase !== 'game_result') {
            // 复盘期：链进度与半场随快照下发；未揭晓的答案只表达为 text 为 null（S63 / S81）
            expect(snapshot.relay?.showcase?.chainIndex).toBe(cell.cursor.chainIndex)
            expect(snapshot.relay?.showcase?.chainCount).toBe(CHAIN_ORIGINS.length)
            expect(snapshot.relay?.showcase?.half).toBe(cell.cursor.half)
            const chain = cell.cursor.chainIndex - 1
            const revealed = cell.phase === 'relay_vote' || cell.cursor.page === 'reveal'
            expect(snapshot.relay?.showcase?.answer.text).toBe(
              revealed
                ? cell.cursor.half === 1
                  ? relayGuessText(chain)
                  : relayLastGuessText(chain)
                : null,
            )
          }

          const serialized = JSON.stringify(snapshot)
          // ② 禁止键清单（含接龙秘密键）与哨兵值
          for (const key of FORBIDDEN_KEYS)
            expect(serialized, `泄漏键 ${key}`).not.toContain(`"${key}"`)
          // 票的「选择」只以字符串出现在匿名票行里，绝不与投票者成对出现（S42）
          expect(serialized, '泄漏了票归属').not.toContain('"choice"')
          const allowed = allowedSentinels(cell.phase, cell.step, viewerIndex, cell.cursor)
          for (const sentinel of RELAY_SENTINELS) {
            if (allowed.includes(sentinel)) continue
            expect(serialized, `泄漏 ${sentinel}`).not.toContain(sentinel)
          }
          // ③ 授权字段可见性真值表：本棒应有的内容必须真在
          for (const sentinel of allowed) expect(serialized).toContain(sentinel)
        })
      }
    }

    it('不在本局链阵容中的成员只拿阶段骨架（无任何链内容）', () => {
      const { room, players } = makeRelayRoom('relay_draw', 1)
      const builder = new SnapshotBuilder(makePort(players, room))

      const snapshot = builder.snapshot(room, UNSEATED_ID)

      expect(snapshot.relay?.stepId).toBe(RELAY_STEP_ID)
      expect(snapshot.relay?.submitted).toBe(false)
      const serialized = JSON.stringify(snapshot)
      for (const sentinel of RELAY_SENTINELS) expect(serialized).not.toContain(sentinel)
    })

    it('开局倒计时（starting）不下发接龙视图，经典房间的 game 路径完全不受影响', () => {
      const { room, players } = makeRelayRoom('starting', 1)
      const relayBuilder = new SnapshotBuilder(makePort(players, room))
      expect(relayBuilder.snapshot(room, HOST_ID).relay).toBeUndefined()

      const { room: classicRoom, players: classicPlayers } = makeRoom('drawing', DRAWER_ID)
      const classicBuilder = new SnapshotBuilder(makePort(classicPlayers, classicRoom))
      expect(classicBuilder.snapshot(classicRoom, HOST_ID).relay).toBeUndefined()
      expect(classicBuilder.snapshot(classicRoom, HOST_ID).game).toBeDefined()
    })
  })
})
