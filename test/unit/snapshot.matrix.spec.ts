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
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
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
  'paused',
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
    ...(phase === 'paused'
      ? { pauseState: { phase: 'drawing' as const, remainingMs: 20_000 } }
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
    // 与生产实现（phase-facts 的 isInMatchPhase）一致：暂停也是对局进行中
    isPlaying: (phase) =>
      ['starting', 'choosing_word', 'drawing', 'round_result', 'paused'].includes(phase),
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
    it('暂停中的 round_result 快照按标称总时长换算 phaseEndsAt，进度条不钉死', () => {
      const { room, players } = makeRoom('paused', DRAWER_ID)
      const game = room.game!
      // 覆盖 fixture 的默认暂停现场：暂停发生在回合结算期，冻结剩余 3 秒。
      // 修复前 round_result 无标称时长，phaseEndsAt 会退化为「阶段开始时间 + 冻结剩余量」，
      // 使客户端进度条分母等于剩余量、被钉死在 100%。
      game.pauseState = { phase: 'round_result', remainingMs: 3_000 }
      const builder = new SnapshotBuilder(makePort(players, room))

      const view = builder.snapshot(room, HOST_ID).game
      expect(view?.phaseBeforePause).toBe('round_result')
      expect(view?.pausedRemainingMs).toBe(3_000)
      const expectedNominalMs =
        (room.settings.allowRoundReplay
          ? APP_CONFIG.game.roundReplaySeconds +
            APP_CONFIG.game.roundReplayPauseSeconds +
            APP_CONFIG.game.roundResultSeconds
          : APP_CONFIG.game.roundResultSeconds) * 1_000
      expect((view?.phaseEndsAt ?? 0) - (view?.phaseStartedAt ?? 0)).toBe(expectedNominalMs)
    })

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
})
