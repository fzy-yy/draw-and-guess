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
import { serverStrings } from '@draw-guess/strings'
import { RelaySnapshotBuilder } from '../../apps/server/src/domain/relay/relay-snapshot.ts'
import type { RelayChainSecret } from '../../apps/server/src/domain/relay/relay-models.ts'
import type { MemberState, PlayerSecret, RoomSecret } from '../../apps/server/src/models.ts'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { createRelayCanvasState } from '../../apps/server/src/domain/relay/relay-models.ts'
import type { RelayShowcaseCursor } from '../../apps/server/src/domain/relay/relay-showcase.ts'
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
const lastGuessTextOf = (chain: number) => `SENTINEL-末答-链${chain}`
const strokeIdOf = (chain: number, half: 1 | 3) => `SENTINEL-笔画-链${chain}-第${half}幅`
const candidateTextOf = (chain: number) => `SENTINEL-候选-链${chain}`

/** 全部链的全部秘密值（矩阵「不该出现」清单的全集）。 */
const ALL_SENTINELS = PLAYER_IDS.flatMap((_id, chain) => [
  wordTextOf(chain),
  guessTextOf(chain),
  lastGuessTextOf(chain),
  strokeIdOf(chain, 1),
  strokeIdOf(chain, 3),
  candidateTextOf(chain),
])

/** 测试侧独立算式：观看者 i 在第 s 棒动手的链（S9 的环状顺延）。 */
function chainForViewer(viewerIndex: number, step: number): number {
  return (viewerIndex - (step - 1) + CHAIN_COUNT) % CHAIN_COUNT
}

/**
 * 测试侧独立算式：「我本棒的链的上一棒动手者」＝席位排在我前一位的玩家。
 * 由 S9 的环状顺延推出（每换一棒动手者整体顺延一位），与被测实现的解析互为参照。
 */
function previousActorOf(viewerIndex: number): number {
  return (viewerIndex - 1 + CHAIN_COUNT) % CHAIN_COUNT
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
        packageId: 'test_pkg',
        packageName: '测试',
      },
    ],
    rerollUsed: false,
    offeredWordIds: new Set([`word-c${chainIndex}`]),
    step1Word: {
      id: `word-c${chainIndex}`,
      text: wordTextOf(chainIndex),
      aliases: [],
      collection: '物品',
      packageId: 'test_pkg',
      packageName: '测试',
    },
    step2Guess: guessTextOf(chainIndex),
    step4Guess: lastGuessTextOf(chainIndex),
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
  cursor?: RelayShowcaseCursor,
): {
  room: RoomSecret
  builder: RelaySnapshotBuilder
  players: Map<string, PlayerSecret>
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
    vocabularyPackageIds: ['test_pkg'],
    selectedWordIds: new Set(['word-c0', 'word-c1', 'word-c2', 'word-c3']),
    relay: {
      id: RELAY_ID,
      startedAt: NOW - 30_000,
      currentStep,
      stepId: STEP_ID,
      phaseStartedAt: NOW - 5_000,
      phaseEndsAt: NOW + 5_000,
      ...(cursor ? { showcase: cursor } : {}),
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
  // 投票期：游标所在链上先落两张真票（第一人赞同、第三人反对）——
  // 「我已投票」与已投票集合都从链上的票箱派生（S41 / S42 / S64），与动手期的提交集是两套记录。
  if (phase === 'relay_vote' && cursor) {
    const chain = room.relay?.chains[cursor.chainIndex - 1]
    if (!chain) throw new Error('投票格缺少游标指向的链')
    chain.votes.push(
      { playerId: PLAYER_IDS[0] ?? '', choice: 'agree' },
      { playerId: PLAYER_IDS[2] ?? '', choice: 'disagree' },
    )
  }
  // 终局：榜单一经冻结就只读；这里给出一行真实形状的条目（其余链内容仍在秘密里，矩阵会证明它们不下发）
  if (phase === 'game_result' && room.relay) {
    room.relay.finalRanking = [
      {
        id: PLAYER_IDS[0] ?? '',
        nickname: '玩家1',
        avatarId: '01',
        rank: 1,
        score: 120,
        chainCount: 4,
        agreeVotes: 9,
      },
    ]
    room.relay.gameResultMinEndsAt = NOW + 5_000
  }
  return { room, builder: new RelaySnapshotBuilder({ players, now: () => NOW }), players }
}

/**
 * 矩阵格子：接龙阶段 × 步骤；复盘期（展示 / 投票）额外带**游标**（链序号 / 半场 / 页，工单 07），
 * 未揭晓与已揭晓两页各占一格——「未揭晓的答案不下发」的最强证据就在这两格的差集上。
 */
const CELLS: { phase: RelayGameView['phase']; step: RelayStep; cursor?: RelayShowcaseCursor }[] = [
  { phase: 'relay_choose', step: 1 },
  { phase: 'relay_draw', step: 1 },
  { phase: 'relay_draw', step: 3 },
  { phase: 'relay_guess', step: 2 },
  { phase: 'relay_guess', step: 4 },
  // 游标缺失的残缺现场：只给阶段骨架，一条链的内容都不猜（fail-safe 不泄漏）
  { phase: 'relay_showcase', step: 4 },
  { phase: 'relay_showcase', step: 4, cursor: { chainIndex: 2, half: 1, page: 'replay' } },
  { phase: 'relay_showcase', step: 4, cursor: { chainIndex: 2, half: 1, page: 'reveal' } },
  { phase: 'relay_showcase', step: 4, cursor: { chainIndex: 3, half: 2, page: 'pause' } },
  { phase: 'relay_vote', step: 4, cursor: { chainIndex: 4, half: 2, page: 'reveal' } },
  // 终局：排名与统计照常下发，但一条链的内容都不在（游标虽在状态里，视图必须丢掉它）
  { phase: 'game_result', step: 4, cursor: { chainIndex: 4, half: 2, page: 'reveal' } },
]

/** 本格允许出现的哨兵值（格子里合法可见的那部分链内容）。 */
function allowedSentinels(
  phase: RelayGameView['phase'],
  step: RelayStep,
  viewerIndex: number,
  cursor?: RelayShowcaseCursor,
) {
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
  // 终局：排名与统计之外没有任何链内容（画作、题面、答案、候选一个都不发）
  if (phase === 'game_result') return []
  // 复盘期（展示 / 投票）：只公开游标指向的那条链，且只公开它轮播到的那半场——与观看者无关。
  // 未揭晓的答案（重播 / 停顿页）不在允许清单里：它的文本与遮罩都不得出现。
  if (!cursor) return []
  const chain = cursor.chainIndex - 1
  // 投票期：左胶囊是该链**初始词**（S44），右胶囊恒为第四棒答案——步 2 的猜词文本不再下发。
  if (phase === 'relay_vote')
    return [wordTextOf(chain), strokeIdOf(chain, cursor.half === 1 ? 1 : 3), lastGuessTextOf(chain)]
  return [
    cursor.half === 1 ? wordTextOf(chain) : guessTextOf(chain),
    strokeIdOf(chain, cursor.half === 1 ? 1 : 3),
    ...(cursor.page === 'reveal'
      ? [cursor.half === 1 ? guessTextOf(chain) : lastGuessTextOf(chain)]
      : []),
  ]
}

describe('接龙视图裁剪矩阵', () => {
  for (const cell of CELLS) {
    it(`${cell.phase}（第 ${cell.step} 棒）：每个观看者只拿到自己本棒所需的链内容`, () => {
      for (let viewerIndex = 0; viewerIndex < CHAIN_COUNT; viewerIndex += 1) {
        const { room, builder } = makeRoom(cell.phase, cell.step, cell.cursor)
        const viewerId = PLAYER_IDS[viewerIndex]
        if (!viewerId) throw new Error('矩阵缺少观看者')
        const view = builder.build(room, viewerId)
        if (!view) throw new Error('接龙阶段必须下发接龙视图')
        const label = `第 ${viewerIndex + 1} 人 / ${cell.phase} / 第 ${cell.step} 棒`

        // 公共骨架：阶段、步骤、阶段时间、我是否已动作、房间聊天流
        expect(view.phase, label).toBe(cell.phase)
        expect(view.currentStep, label).toBe(cell.step)
        expect(view.stepId, label).toBe(STEP_ID)
        expect(view.phaseStartedAt, label).toBe(room.relay?.phaseStartedAt)
        expect(view.phaseEndsAt, label).toBe(room.relay?.phaseEndsAt)
        // 已动作集合：动手期＝本步已提交（只第一人）、投票期＝已投票（第一、三人，S41 / S64）；
        // 集合里只有 id，永远不含选择与计数
        const actors =
          cell.phase === 'relay_vote' ? [PLAYER_IDS[0], PLAYER_IDS[2]] : [PLAYER_IDS[0]]
        expect(view.submitted, label).toBe(actors.includes(viewerId))
        expect(view.submittedPlayerIds, label).toEqual(actors)
        expect(
          view.messages.map((message) => message.text),
          label,
        ).toEqual(['大家加油'])

        const allowed = allowedSentinels(cell.phase, cell.step, viewerIndex, cell.cursor)
        const serialized = JSON.stringify(view)
        for (const sentinel of ALL_SENTINELS) {
          if (allowed.includes(sentinel)) continue
          expect(serialized, `${label}：泄漏了 ${sentinel}`).not.toContain(sentinel)
        }
        for (const sentinel of allowed) {
          expect(serialized, `${label}：缺少本棒应有的 ${sentinel}`).toContain(sentinel)
        }

        // 复盘期：公开内容与观看者无关，未揭晓的答案在载荷里只表达为 text 为 null；
        // 终局：连游标都失去意义——showcase 必须缺席，只有排名与统计（S33）
        if (cell.phase === 'game_result') {
          expect(view.showcase, label).toBeUndefined()
          expect(view.finalRanking?.[0], label).toMatchObject({
            rank: 1,
            score: 120,
            chainCount: 4,
            agreeVotes: 9,
          })
          // 观众不是房主 / 尚未过最短展示期 → 没有全局返回权
          expect(view.canReturnWaiting, label).toBe(false)
        } else if (cell.cursor) {
          const showcase = view.showcase
          const chain = cell.cursor.chainIndex - 1
          expect(showcase?.chainIndex, label).toBe(cell.cursor.chainIndex)
          expect(showcase?.chainCount, label).toBe(CHAIN_COUNT)
          expect(showcase?.half, label).toBe(cell.cursor.half)
          // 投票期左胶囊＝该链**初始词**（S44）；展示期才按半场取题面（半场 2 是 step2Guess）
          expect(showcase?.prompt.text, label).toBe(
            cell.phase === 'relay_vote' || cell.cursor.half === 1
              ? wordTextOf(chain)
              : guessTextOf(chain),
          )
          expect(
            showcase?.drawing.strokes.map((command) => command.id),
            label,
          ).toEqual([strokeIdOf(chain, cell.cursor.half === 1 ? 1 : 3)])
          const revealed = cell.phase === 'relay_vote' || cell.cursor.page === 'reveal'
          expect(showcase?.answer.text, label).toBe(
            revealed
              ? cell.cursor.half === 1
                ? guessTextOf(chain)
                : lastGuessTextOf(chain)
              : null,
          )
          // 左 chip＝左胶囊文本的作者（投票期＝初始词作者即链发起人；展示期＝本半场画家），
          // 右 chip＝猜词者（本半场答案的作者，投票期恒为第四棒）——角标由位置派生，不在载荷里
          const promptOffset = cell.phase === 'relay_vote' || cell.cursor.half === 1 ? 0 : 2
          expect(showcase?.prompt.player.id, label).toBe(
            PLAYER_IDS[(chain + promptOffset) % CHAIN_COUNT],
          )
          expect(showcase?.answer.player.id, label).toBe(
            PLAYER_IDS[(chain + (cell.cursor.half === 1 ? 1 : 3)) % CHAIN_COUNT],
          )
          // 票行只在投票期出现，且是按到达顺序的选择列表（无归属，S42）
          expect(showcase?.votes, label).toEqual(
            cell.phase === 'relay_vote' ? ['agree', 'disagree'] : undefined,
          )
          // 票行与已投票集合合起来也不能还原「谁投了什么」：载荷里不存在成对的归属结构
          expect(JSON.stringify(view), label).not.toContain('"choice"')
        }

        // 按阶段断言「本棒产物」的字段形状
        const ownChain = chainForViewer(viewerIndex, cell.step)
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
          // 上一家 = 上一棒的动手者（看上一家的画，客户端据此加画笔角标）：
          // 步 2 是链发起人（画第一幅），步 4 是第三棒（画第二幅）——两幅画的画者不是同一个人
          expect(view.previousArtist?.id, label).toBe(PLAYER_IDS[previousActorOf(viewerIndex)])
          expect(view.prompt, label).toBeUndefined()
          expect(view.ownCanvas, label).toBeUndefined()
          expect(view.wordOptions, label).toBeUndefined()
        }
      }
    })
  }

  it('身份已回收的链发起人：其链照常展示，chip 回落到中性占位身份（S7 / S12）', () => {
    // 第 2 条链（半场 1 的画家＝链发起人）正在展示，而他的身份已被回收：
    // 成员表没有、玩家册也没有——轮播绝不为一个人的资料缺失而断（S12）。
    const { room, builder, players } = makeRoom('relay_showcase', 4, {
      chainIndex: 2,
      half: 1,
      page: 'reveal',
    })
    const missingId = PLAYER_IDS[1]
    if (!missingId) throw new Error('矩阵缺少第二条链的发起人')
    room.members = room.members.filter((member) => member.playerId !== missingId)
    players.delete(missingId)

    const view = builder.build(room, PLAYER_IDS[0] ?? '')

    expect(view?.showcase?.prompt.player).toEqual({
      id: missingId,
      nickname: serverStrings.notices.fallbackPlayerName,
      avatarId: APP_CONFIG.player.defaultAvatarId,
    })
    // 占位 chip 是合法载荷，不是缺字段（客户端按同一形状渲染头像与昵称）
    expect(view?.showcase?.prompt.text).toBe(wordTextOf(1))
  })

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

    // 复盘期同理：即使房间带着游标，链阵容外的成员也拿不到任何链内容（fail-safe 最小暴露）
    const { room: showcaseRoom, builder: showcaseBuilder } = makeRoom('relay_showcase', 4, {
      chainIndex: 1,
      half: 1,
      page: 'reveal',
    })
    const outsiderView = showcaseBuilder.build(showcaseRoom, OUTSIDER_ID)
    expect(outsiderView?.showcase).toBeUndefined()
    const showcaseSerialized = JSON.stringify(outsiderView)
    for (const sentinel of ALL_SENTINELS) expect(showcaseSerialized).not.toContain(sentinel)
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
