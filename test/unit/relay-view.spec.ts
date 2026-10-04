/**
 * 接龙视图裁剪矩阵（S9 / S31 / S35 / S63）：角色 × 接龙阶段 × 步骤 × 链归属。
 *
 * 断言口径（只读快照的外部可观察内容）：
 * - 每个格子只下发「观看者本棒所需」的链内容，链归属由测试侧的独立算式给出
 *   （链 j 的第 s 棒动手者是链 (j + s - 1) 的发起人 ⇒ 观看者 i 本棒的链 = (i - s + 1) mod N）；
 * - 其余链的题面、猜词文本与两幅画作一律不下发：全部秘密内容带 SENTINEL 前缀，
 *   逐格断言「本格不该出现的哨兵值」一个都不在序列化结果里；
 * - 步 3 只给上家的文本（不给上家的画、不给该链原本的题面）；步 2/4 只给上家的画（不给任何文本）；
 * - 不在本局链阵容中的成员只拿阶段骨架；`submitted` 按本步已提交集派生（S64）。
 */
import { describe, expect, it } from 'vitest'
import type { RelayGameView, RelayStep, RoomPhase } from '@draw-guess/shared'
import { RelaySnapshotBuilder } from '../../apps/server/src/domain/relay/relay-snapshot.ts'
import type { RelayChainSecret } from '../../apps/server/src/domain/relay/relay-models.ts'
import type { MemberState, PlayerSecret, RoomSecret } from '../../apps/server/src/models.ts'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { createRelayCanvasState } from '../../apps/server/src/domain/relay/relay-models.ts'
import { testRoomSettings } from './helpers/game-harness.ts'

const NOW = 1_700_000_000_000
const ROOM_ID = '00000000-0000-4000-8000-000000000101'
const RELAY_ID = '00000000-0000-4000-8000-000000000202'
const STEP_ID = '00000000-0000-4000-8000-000000000303'
const CHAIN_COUNT = 4
const PLAYER_IDS = [
  '00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000b2',
  '00000000-0000-4000-8000-0000000000c3',
  '00000000-0000-4000-8000-0000000000d4',
]
const OUTSIDER_ID = '00000000-0000-4000-8000-0000000000e5'

/** 秘密内容的哨兵值：任何不该看见它们的一格，序列化结果里都不能出现（换键位泄漏也会被抓）。 */
const wordTextOf = (chain: number) => `SENTINEL-题面-链${chain}`
const guessTextOf = (chain: number) => `SENTINEL-猜词-链${chain}`
const strokeIdOf = (chain: number, half: 1 | 3) => `SENTINEL-笔画-链${chain}-第${half}幅`
const candidateTextOf = (chain: number) => `SENTINEL-候选-链${chain}`

/** 全部链的全部秘密值（矩阵「不该出现」清单的全集）。 */
const ALL_SENTINELS = PLAYER_IDS.flatMap((_id, chain) => [
  wordTextOf(chain),
  guessTextOf(chain),
  strokeIdOf(chain, 1),
  strokeIdOf(chain, 3),
  candidateTextOf(chain),
])

/** 测试侧独立算式：观看者 i 在第 s 棒动手的链（S9 的环状顺延）。 */
function chainForViewer(viewerIndex: number, step: RelayStep): number {
  return (viewerIndex - (step - 1) + CHAIN_COUNT) % CHAIN_COUNT
}

/** 一条链的完整秘密现场：两幅画各一笔、题面与步 2 猜词文本都是哨兵值。 */
function makeChain(originPlayerId: string, chainIndex: number): RelayChainSecret {
  const chain = {
    originPlayerId,
    step1Canvas: createRelayCanvasState(),
    step3Canvas: createRelayCanvasState(),
    candidates: [
      {
        id: `word-c${chainIndex}`,
        text: candidateTextOf(chainIndex),
        aliases: [],
        collection: '物品',
      },
    ],
    rerollUsed: false,
    offeredWordIds: new Set([`word-c${chainIndex}`]),
    step1Word: {
      id: `word-c${chainIndex}`,
      text: wordTextOf(chainIndex),
      aliases: [],
      collection: '物品',
    },
    step2Guess: guessTextOf(chainIndex),
    votes: [],
  } satisfies RelayChainSecret
  chain.step1Canvas.strokes = [
    {
      kind: 'stroke',
      id: strokeIdOf(chainIndex, 1),
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
      id: strokeIdOf(chainIndex, 3),
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

function makePlayer(playerId: string, nickname: string): PlayerSecret {
  return {
    id: playerId,
    tokenDigest: `digest-${nickname}`,
    profile: { nickname, avatarId: '01' },
    preferences: { discoverable: true, acceptsInvites: true },
    roomId: ROOM_ID,
    connected: true,
    joinedAt: NOW - 10_000,
    disconnectGeneration: 0,
    requestCache: new Map(),
    lastInviteAt: new Map(),
    guessEventTimes: [],
    drawEventTimes: [],
    privateJoinAttemptTimes: [],
  }
}

/** 组装一格矩阵输入：房间挂在指定接龙阶段与步骤，已提交集只含第一人。 */
function makeRoom(
  phase: RoomPhase,
  currentStep: RelayStep,
): {
  room: RoomSecret
  builder: RelaySnapshotBuilder
} {
  const players = new Map<string, PlayerSecret>()
  const members: MemberState[] = []
  PLAYER_IDS.forEach((playerId, index) => {
    players.set(playerId, makePlayer(playerId, `玩家${index + 1}`))
    members.push({
      playerId,
      seatIndex: index,
      ready: false,
      score: 0,
      joinedAt: NOW - 60_000,
      stats: { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 },
    })
  })
  players.set(OUTSIDER_ID, makePlayer(OUTSIDER_ID, '残连'))
  members.push({
    playerId: OUTSIDER_ID,
    seatIndex: 4,
    ready: false,
    score: 0,
    joinedAt: NOW - 60_000,
    stats: { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 },
  })

  const room: RoomSecret = {
    id: ROOM_ID,
    name: '接龙矩阵房',
    hostId: PLAYER_IDS[0] ?? '',
    visibility: 'public',
    gameMode: 'relay',
    phase,
    stateVersion: 9,
    settings: testRoomSettings(),
    members,
    selectedWordIds: new Set(['word-c0', 'word-c1', 'word-c2', 'word-c3']),
    relay: {
      id: RELAY_ID,
      startedAt: NOW - 30_000,
      currentStep,
      stepId: STEP_ID,
      phaseStartedAt: NOW - 5_000,
      phaseEndsAt: NOW + 5_000,
      chains: PLAYER_IDS.map((playerId, index) => makeChain(playerId, index)),
      stepSubmissions: new Set([PLAYER_IDS[0] ?? '']),
      messages: [
        {
          id: '00000000-0000-4000-8000-000000000404',
          type: 'guess',
          text: '大家加油',
          playerId: PLAYER_IDS[1] ?? '',
          createdAt: NOW - 1_000,
        },
      ],
    },
  }
  return { room, builder: new RelaySnapshotBuilder({ players }) }
}

const CELLS: { phase: RelayGameView['phase']; step: RelayStep }[] = [
  { phase: 'relay_choose', step: 1 },
  { phase: 'relay_draw', step: 1 },
  { phase: 'relay_draw', step: 3 },
  { phase: 'relay_guess', step: 2 },
  { phase: 'relay_guess', step: 4 },
  { phase: 'relay_showcase', step: 4 },
  { phase: 'relay_vote', step: 4 },
]

/** 本格允许出现的哨兵值（格子里合法可见的那部分链内容）。 */
function allowedSentinels(phase: RelayGameView['phase'], step: RelayStep, viewerIndex: number) {
  const ownChain = chainForViewer(viewerIndex, step)
  if (phase === 'relay_choose') return [candidateTextOf(ownChain)]
  if (phase === 'relay_draw') {
    return step === 1
      ? [wordTextOf(ownChain), strokeIdOf(ownChain, 1)]
      : [guessTextOf(ownChain), strokeIdOf(ownChain, 3)]
  }
  if (phase === 'relay_guess') {
    return [strokeIdOf(ownChain, step === 2 ? 1 : 3)]
  }
  return []
}

describe('接龙视图裁剪矩阵', () => {
  for (const cell of CELLS) {
    it(`${cell.phase}（第 ${cell.step} 棒）：每个观看者只拿到自己本棒所需的链内容`, () => {
      for (let viewerIndex = 0; viewerIndex < CHAIN_COUNT; viewerIndex += 1) {
        const { room, builder } = makeRoom(cell.phase, cell.step)
        const viewerId = PLAYER_IDS[viewerIndex]
        if (!viewerId) throw new Error('矩阵缺少观看者')
        const view = builder.build(room, viewerId)
        if (!view) throw new Error('接龙阶段必须下发接龙视图')
        const label = `第 ${viewerIndex + 1} 人 / ${cell.phase} / 第 ${cell.step} 棒`

        // 公共骨架：阶段、步骤、阶段时间、我是否已提交、房间聊天流
        expect(view.phase, label).toBe(cell.phase)
        expect(view.currentStep, label).toBe(cell.step)
        expect(view.stepId, label).toBe(STEP_ID)
        expect(view.phaseStartedAt, label).toBe(room.relay?.phaseStartedAt)
        expect(view.phaseEndsAt, label).toBe(room.relay?.phaseEndsAt)
        expect(view.submitted, label).toBe(viewerIndex === 0)
        expect(
          view.messages.map((message) => message.text),
          label,
        ).toEqual(['大家加油'])

        const allowed = allowedSentinels(cell.phase, cell.step, viewerIndex)
        const serialized = JSON.stringify(view)
        for (const sentinel of ALL_SENTINELS) {
          if (allowed.includes(sentinel)) continue
          expect(serialized, `${label}：泄漏了 ${sentinel}`).not.toContain(sentinel)
        }
        for (const sentinel of allowed) {
          expect(serialized, `${label}：缺少本棒应有的 ${sentinel}`).toContain(sentinel)
        }

        // 按阶段断言「本棒产物」的字段形状
        const ownChain = chainForViewer(viewerIndex, cell.step)
        const chain = room.relay?.chains[ownChain]
        if (cell.phase === 'relay_choose') {
          expect(
            view.wordOptions?.map((word) => word.text),
            label,
          ).toEqual([candidateTextOf(ownChain)])
          expect(view.canReroll, label).toBe(room.settings.allowWordReroll)
        }
        if (cell.phase === 'relay_draw') {
          expect(view.prompt, label).toBe(
            cell.step === 1 ? wordTextOf(ownChain) : guessTextOf(ownChain),
          )
          expect(
            view.ownCanvas?.strokes.map((command) => command.id),
            label,
          ).toEqual([strokeIdOf(ownChain, cell.step === 1 ? 1 : 3)])
          expect(view.previousDrawing, label).toBeUndefined()
          // 步 3 的上一家是「出题者」（不带画笔角标的那位），步 1 没有上一家
          expect(view.previousArtist?.id, label).toBe(
            cell.step === 1 ? undefined : PLAYER_IDS[chainForViewer(viewerIndex, 2)],
          )
        }
        if (cell.phase === 'relay_guess') {
          expect(
            view.previousDrawing?.strokes.map((command) => command.id),
            label,
          ).toEqual([strokeIdOf(ownChain, cell.step === 2 ? 1 : 3)])
          // 上一家 = 该链发起人（他动笔画过，客户端据此加画笔角标）
          expect(view.previousArtist?.id, label).toBe(chain?.originPlayerId)
          expect(view.prompt, label).toBeUndefined()
          expect(view.ownCanvas, label).toBeUndefined()
          expect(view.wordOptions, label).toBeUndefined()
        }
      }
    })
  }

  it('不在本局链阵容中的成员只拿阶段骨架：不含任何链内容', () => {
    const { room, builder } = makeRoom('relay_draw', 1)

    const view = builder.build(room, OUTSIDER_ID)

    expect(view?.phase).toBe('relay_draw')
    expect(view?.stepId).toBe(STEP_ID)
    expect(view?.submitted).toBe(false)
    expect(view?.wordOptions).toBeUndefined()
    expect(view?.prompt).toBeUndefined()
    expect(view?.ownCanvas).toBeUndefined()
    expect(view?.previousDrawing).toBeUndefined()
    const serialized = JSON.stringify(view)
    for (const sentinel of ALL_SENTINELS) expect(serialized).not.toContain(sentinel)
  })

  it('非接龙阶段（starting / waiting）与没有接龙局的房间不下发接龙视图', () => {
    const { room, builder } = makeRoom('relay_choose', 1)
    const starting = structuredClone(room)
    starting.phase = 'starting'
    expect(builder.build(starting, PLAYER_IDS[0] ?? '')).toBeUndefined()

    const waiting = structuredClone(room)
    waiting.phase = 'waiting'
    delete waiting.relay
    expect(builder.build(waiting, PLAYER_IDS[0] ?? '')).toBeUndefined()
  })

  it('聊天流只下发最近 N 条（与经典视图同一队列口径）', () => {
    const { room, builder } = makeRoom('relay_choose', 1)
    const relay = room.relay
    if (!relay) throw new Error('矩阵缺少接龙局')
    relay.messages = Array.from({ length: APP_CONFIG.ui.recentMessageCount + 5 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 500).padStart(12, '0')}`,
      type: 'system' as const,
      text: `通知${index}`,
      createdAt: NOW + index,
    }))

    const view = builder.build(room, PLAYER_IDS[0] ?? '')

    expect(view?.messages).toHaveLength(APP_CONFIG.ui.recentMessageCount)
    expect(view?.messages[0]?.text).toBe('通知5')
  })
})
