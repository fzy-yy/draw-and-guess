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
const SPECTATOR_ID = '00000000-0000-4000-8000-0000000000d4'
const NEXT_GAME_ID = '00000000-0000-4000-8000-0000000000e5'
const LEFT_GAME_ID = '00000000-0000-4000-8000-0000000000f6'
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
  'revealedIndices',
  'hintOrder',
  'revealedHintCount',
  'roundSettled',
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
  'paused',
  'game_result',
]

/** 观看者在其所在格子中的身份标签。 */
type ViewerRole =
  'drawer-host' | 'drawer' | 'guesser' | 'host-not-drawer' | 'spectator' | 'next-game' | 'left-game'

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
    hintOrder: [0],
    revealedHintCount: 1,
    drawingRevision: 2,
    // 结算阶段补全结算数据，覆盖更多裁剪分支
    ...(settled
      ? {
          roundResult: { answer: answer?.text ?? '', details: [], drawerScore: 80 },
          correctDetails: [{ playerId: GUESSER_ID, base: 100, speed: 40, order: 10, total: 150 }],
        }
      : {}),
    ...(phase === 'paused'
      ? { phaseBeforePause: 'drawing' as const, pausedRemainingMs: 20_000 }
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
  { role: 'spectator', viewerId: SPECTATOR_ID },
  { role: 'next-game', viewerId: NEXT_GAME_ID },
  { role: 'left-game', viewerId: LEFT_GAME_ID },
]

/**
 * 组装一个房间：画家固定为 drawerId，成员覆盖 7 种身份；
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
    makeMember(SPECTATOR_ID, 2, { spectating: true }),
    makeMember(NEXT_GAME_ID, 3, { waitingForNextGame: true }),
    // 已离局成员：无 player 身份也能渲染（leftProfile 兜底路径）
    {
      ...makeMember(LEFT_GAME_ID, 4, { leftGame: true }),
      leftProfile: { nickname: '已离局', avatarId: '02' },
    },
  ]
  // drawerId 恰为固定角色成员时会产生重复 playerId：后写覆盖，保留带角色标记的席位
  //（如「观战者兼任画家」防御格要求 spectating 席位不被普通席位遮蔽）。
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
    privateJoinCode: options.visibility === 'private' ? PRIVATE_CODE : undefined,
    phase,
    stateVersion: 7,
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
    case 'spectator':
      return SPECTATOR_ID
    case 'next-game':
      return NEXT_GAME_ID
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
        // 画家本人（房主与否无关）在任何阶段都收 answer/wordHint 真值；
        // 观战身份即使 ID 与 drawerId 相同也不算画家。
        const isViewerDrawer =
          (role === 'drawer' || role === 'drawer-host') && viewerId === roomDrawerId
        // answer 与完整提示只发给画家本人（所有对局阶段一致）
        if (isViewerDrawer) {
          expect(gameView?.answer).toBe(room.game?.answer?.text)
          expect(gameView?.wordHint).toBeDefined()
        } else {
          expect(gameView?.answer).toBeUndefined()
          expect(gameView?.wordHint).toBeUndefined()
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
    it('私密房码只进当前房主的快照，普通成员与观战拿不到', () => {
      const { room, players } = makeRoom('drawing', DRAWER_ID, { visibility: 'private' })
      const builder = new SnapshotBuilder(makePort(players, room))

      expect(builder.snapshot(room, HOST_ID).privateJoinCode).toBe(PRIVATE_CODE)
      expect(builder.snapshot(room, DRAWER_ID).privateJoinCode).toBeUndefined()
      expect(builder.snapshot(room, SPECTATOR_ID).privateJoinCode).toBeUndefined()
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
      const offlineMember = roomWithStrokes.members.find((m) => m.playerId === NEXT_GAME_ID)!
      offlineMember.lastSyncedSeq = roomWithStrokes.game!.lastSequence
      players.get(NEXT_GAME_ID)!.connected = false

      const builder = new SnapshotBuilder(makePort(players, roomWithStrokes))
      const synced = builder.snapshot(roomWithStrokes, HOST_ID)
      const behind = builder.snapshot(roomWithStrokes, DRAWER_ID)
      const offline = builder.snapshot(roomWithStrokes, NEXT_GAME_ID)

      expect(synced.game?.strokes).toEqual([])
      expect(synced.game?.strokesOmitted).toBe(true)
      expect(behind.game?.strokes).toEqual(strokes)
      expect(behind.game?.strokesOmitted).toBeUndefined()
      expect(offline.game?.strokes).toEqual(strokes)
      expect(offline.game?.strokesOmitted).toBeUndefined()
    })

    it('观战身份即使 ID 恰好等于 drawerId 也拿不到画家视图', () => {
      const { players } = makeRoom('drawing', SPECTATOR_ID)
      const { room } = makeRoom('drawing', SPECTATOR_ID)
      // 画家即观战成员本人：异常时序防御路径
      const builder = new SnapshotBuilder(makePort(players, room))
      const snapshot = builder.snapshot(room, SPECTATOR_ID)
      expect(snapshot.game?.answer).toBeUndefined()
      expect(snapshot.game?.wordOptions).toBeUndefined()
    })

    it('非成员观看者被拒绝且不泄漏房间字段', () => {
      const { room, players } = makeRoom('drawing', DRAWER_ID)
      const builder = new SnapshotBuilder(makePort(players, room))
      expect(() => builder.snapshot(room, '00000000-0000-4000-8000-000000000999')).toThrow(
        GameError,
      )
    })
  })
})
