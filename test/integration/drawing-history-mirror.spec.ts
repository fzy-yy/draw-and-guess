import { setActivePinia, type Pinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import {
  ERROR_CODES,
  EVENTS,
  type DrawingCommand,
  type FillCommand,
  type RoomSnapshot,
  type Stroke,
} from '@draw-guess/shared'
import { serverErrorMessages } from '@draw-guess/strings'
import { useRoomStore } from '@/stores/room'
import { useGameplayStore } from '@/stores/gameplay'
import { useRoomSync } from '@/composables/useRoomSync'
import { createRoomFixture } from '../client/room-fixture'
import { createPiniaWithFakeTransport } from '../client/fake-game-transport'
import {
  createGameHarness,
  startTwoPlayerGame,
  type GameHarness,
} from '../unit/helpers/game-harness'

/**
 * 绘图历史镜像一致性（客户端 reducer 视角）。
 *
 * 服务端是权威来源，客户端镜像只能逐条跟随服务端推送；两端都必须**永不**为了容量压力静默丢弃
 * 最旧命令——否则早期封闭边界会从重放历史里消失，之后在边界内提交的填充会吞掉整张画布，
 * 且增量镜像与权威全量快照的重放结果不再一致（见 docs/adr/0010-drawing-history-cap.md）。
 *
 * 本文件用真实服务端服务 + 真实客户端 reducer（useRoomSync）驱动同一条历史：
 * 「增量镜像」由推送逐条构建，「权威历史」取自服务端全量快照，两者必须逐条一致。
 */
const COMMAND_STEP_MS = 25
const BOUNDARY_ID = 'boundary-line'
const FILL_ID = 'fill-inside-boundary'

let pinia: Pinia
let fakeTransport: ReturnType<typeof createPiniaWithFakeTransport>['fakeTransport']

beforeEach(() => {
  const created = createPiniaWithFakeTransport()
  pinia = created.pinia
  fakeTransport = created.fakeTransport
  setActivePinia(pinia)
})

function enterDrawing() {
  const harness = createGameHarness()
  const state = startTwoPlayerGame(harness)
  const candidate = state.game.candidates[0]
  if (!candidate) throw new Error('测试词库未生成候选词')
  harness.backend.gameplay.chooseWord(state.game.drawerId, state.game.roundId, candidate.id)
  return { harness, ...state }
}

type Scenario = ReturnType<typeof enterDrawing>

function dotStroke(sequence: number, index: number): Stroke {
  return {
    kind: 'stroke',
    id: `stroke-${index}`,
    tool: 'pen',
    color: '#1F2937',
    width: 5,
    sequence,
    startPointIndex: 0,
    points: [{ x: 0.3, y: 0.3 }],
  }
}

function fillCommand(sequence: number): FillCommand {
  return {
    kind: 'fill',
    id: FILL_ID,
    point: { x: 0.2, y: 0.5 },
    color: '#EF4444',
    sequence,
  }
}

function addStroke(scenario: Scenario, stroke: Stroke) {
  scenario.harness.runtime.jump(COMMAND_STEP_MS)
  return scenario.harness.backend.drawing.classic.addStroke(
    scenario.game.drawerId,
    scenario.game.roundId,
    stroke,
  )
}

function addFill(scenario: Scenario, fill: FillCommand) {
  scenario.harness.runtime.jump(COMMAND_STEP_MS)
  return scenario.harness.backend.drawing.classic.addFill(
    scenario.game.drawerId,
    scenario.game.roundId,
    fill,
  )
}

/** 早期封闭边界（竖直墨线）+ 后续填充（只覆盖左侧封闭区域）+ 填充到命令上限。 */
function fillHistoryToCap(scenario: Scenario): number {
  let sequence = 0
  addStroke(scenario, {
    ...dotStroke(sequence++, 0),
    id: BOUNDARY_ID,
    points: [
      { x: 0.5, y: 0.05 },
      { x: 0.5, y: 0.95 },
    ],
  })
  addFill(scenario, fillCommand(sequence++))
  const fillerCount = APP_CONFIG.drawing.maxHistoryCommands - scenario.game.strokes.length
  for (let index = 0; index < fillerCount; index += 1) {
    addStroke(scenario, dotStroke(sequence++, index))
  }
  return sequence
}

/** 客户端镜像：房间快照只建立一次，之后把服务端推送按到达顺序交给真实 reducer。 */
function createClientMirror(scenario: Scenario) {
  const roomStore = useRoomStore()
  const roomSync = useRoomSync()
  const { harness, room, game } = scenario
  // 房间 ID 必须与权威推送一致，否则增量门禁会把推送判为「非本房间」而忽略。
  roomStore.room = {
    ...createRoomFixture('drawing', {
      gameId: game.id,
      roundId: game.roundId,
      strokes: [],
      undoneStrokeIds: [],
      lastSequence: -1,
      drawingRevision: 0,
    }),
    id: room.id,
  }
  let cursor = 0

  function applyPushes(): void {
    for (const entry of harness.ioEvents.slice(cursor)) {
      const data = (entry.payload as { data: Record<string, unknown> }).data
      const meta = {
        roomId: room.id,
        gameId: game.id,
        roundId: game.roundId,
        drawingRevision: data.drawingRevision as number,
      }
      if (entry.event === EVENTS.drawStrokeBatch)
        roomSync.onStroke(meta, data.stroke as unknown as Stroke)
      else if (entry.event === EVENTS.drawFillCommit)
        roomSync.onFill(meta, data.fill as unknown as FillCommand)
    }
    cursor = harness.ioEvents.length
  }

  return {
    roomStore,
    roomSync,
    applyPushes,
    get strokes(): DrawingCommand[] {
      const strokes = roomStore.room?.game?.strokes
      if (!strokes) throw new Error('客户端镜像缺少画布历史')
      return strokes
    },
    get undoneStrokeIds(): string[] {
      return roomStore.room?.game?.undoneStrokeIds ?? []
    },
  }
}

/** 与 E2E 的逻辑画布哈希同构：对可见命令序列做 FNV-1a 指纹，作为「全量重放结果」的代理。 */
function replayFingerprint(
  commands: readonly DrawingCommand[],
  undoneIds: readonly string[],
): string {
  const undone = new Set(undoneIds)
  let hash = 0x811c9dc5
  const feed = (text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  for (const command of commands) {
    if (undone.has(command.id)) continue
    feed(command.kind === 'stroke' ? `s:${command.id}:${command.points.length}` : `f:${command.id}`)
    feed(`:${command.sequence}:${command.color}`)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function visibleIds(commands: readonly DrawingCommand[], undoneIds: readonly string[]): string[] {
  const undone = new Set(undoneIds)
  return commands.filter((command) => !undone.has(command.id)).map((command) => command.id)
}

function authoritativeSnapshot(harness: GameHarness, viewerId: string): RoomSnapshot {
  const snapshot = harness.backend.publisher.snapshotForPlayer(viewerId, true)
  if (!snapshot) throw new Error('缺少权威快照')
  return snapshot
}

describe('绘图历史镜像一致性', () => {
  it('达到命令上限后镜像与权威历史逐条一致，早期封闭边界与后续填充都还在', () => {
    const scenario = enterDrawing()
    const { harness, game, guest } = scenario
    const limit = APP_CONFIG.drawing.maxHistoryCommands
    const nextSequence = fillHistoryToCap(scenario)
    const client = createClientMirror(scenario)
    client.applyPushes()

    const authoritative = authoritativeSnapshot(harness, guest.playerId).game?.strokes ?? []
    expect(client.strokes).toHaveLength(limit)
    expect(visibleIds(client.strokes, client.undoneStrokeIds)).toEqual(
      visibleIds(authoritative, []),
    )
    expect(replayFingerprint(client.strokes, client.undoneStrokeIds)).toBe(
      replayFingerprint(authoritative, []),
    )
    expect(authoritative[0]?.id).toBe(BOUNDARY_ID)
    expect(authoritative[1]?.id).toBe(FILL_ID)

    // 超限命令不会到达客户端：服务端拒绝后既不推增量、也不改动权威历史。
    expect(() => addStroke(scenario, dotStroke(nextSequence, limit + 1))).toThrow(
      serverErrorMessages[ERROR_CODES.DRAW_HISTORY_LIMIT_REACHED],
    )
    client.applyPushes()
    expect(client.strokes).toHaveLength(limit)
    expect(replayFingerprint(client.strokes, client.undoneStrokeIds)).toBe(
      replayFingerprint(authoritativeSnapshot(harness, guest.playerId).game?.strokes ?? [], []),
    )
    expect(game.strokes.some((command) => command.id === BOUNDARY_ID)).toBe(true)
  })

  it('一直在线与晚加入的客户端对同一条历史重放结果完全一致', () => {
    const scenario = enterDrawing()
    const { harness, game, guest } = scenario
    const limit = APP_CONFIG.drawing.maxHistoryCommands
    const incremental = createClientMirror(scenario)
    let nextSequence = fillHistoryToCap(scenario)
    incremental.applyPushes()

    // 容量压力之下仍可继续撤销：撤销释放名额，下一条命令可以正常提交。
    harness.backend.drawing.classic.undo(game.drawerId, game.roundId)
    incremental.applyPushes()
    // 客户端从权威房间快照同步撤销结果与画布修订（真实路径由 useRoomSync 应用快照完成）。
    incremental.roomStore.room!.game!.undoneStrokeIds = [...game.undoneStrokeIds]
    incremental.roomStore.room!.game!.drawingRevision = game.drawingRevision
    harness.runtime.jump(COMMAND_STEP_MS)
    expect(() =>
      harness.backend.drawing.classic.addStroke(
        game.drawerId,
        game.roundId,
        dotStroke(nextSequence++, limit + 10),
      ),
    ).not.toThrow()
    incremental.applyPushes()
    expect(incremental.strokes).toHaveLength(limit)

    // 名额用尽后再提交：确定性拒绝，权威历史与镜像都不发生任何变化。
    expect(() => addStroke(scenario, dotStroke(nextSequence, limit + 11))).toThrow(
      serverErrorMessages[ERROR_CODES.DRAW_HISTORY_LIMIT_REACHED],
    )
    incremental.applyPushes()
    expect(incremental.strokes[0]?.id).toBe(BOUNDARY_ID)

    // 晚加入的客户端只拿到权威全量快照：重放结果必须与一直在线者的增量镜像逐条一致。
    const snapshot = authoritativeSnapshot(harness, guest.playerId)
    const freshPinia = createPiniaWithFakeTransport().pinia
    setActivePinia(freshPinia)
    const lateRoomStore = useRoomStore()
    const lateRoomSync = useRoomSync()
    lateRoomSync.onRoomSnapshot(snapshot)
    const lateStrokes = lateRoomStore.room?.game?.strokes
    if (!lateStrokes) throw new Error('晚加入客户端缺少画布历史')

    expect(lateStrokes).toHaveLength(limit)
    expect(lateStrokes[0]?.id).toBe(BOUNDARY_ID)
    expect(lateStrokes[1]?.id).toBe(FILL_ID)
    expect(lateStrokes.map((command) => command.id)).toEqual(
      incremental.strokes.map((command) => command.id),
    )
    expect(replayFingerprint(lateStrokes, snapshot.game?.undoneStrokeIds ?? [])).toBe(
      replayFingerprint(incremental.strokes, incremental.undoneStrokeIds),
    )
  })

  it('上限拒绝在客户端可见：笔画与填充各提示一次，且不改变画布历史', async () => {
    const scenario = enterDrawing()
    const client = createClientMirror(scenario)
    const gameplay = useGameplayStore()
    const limitMessage = serverErrorMessages[ERROR_CODES.DRAW_HISTORY_LIMIT_REACHED]
    fakeTransport.setResponder((_event, payload) => ({
      ok: false,
      requestId: String(payload.requestId),
      error: { code: ERROR_CODES.DRAW_HISTORY_LIMIT_REACHED, message: limitMessage },
    }))

    const strokesBefore = client.strokes.length
    const strokeResult = await gameplay.sendStroke(dotStroke(0, 999))
    const fillResult = await gameplay.sendFill(fillCommand(0))

    expect(strokeResult.ok).toBe(false)
    expect(fillResult.ok).toBe(false)
    expect(fakeTransport.notifications.map((item) => item.text)).toEqual([
      limitMessage,
      limitMessage,
    ])
    expect(fakeTransport.notifications.every((item) => item.type === 'warning')).toBe(true)
    // 被拒绝的请求不会写进本地镜像：画布历史仍只由服务端推送决定。
    expect(client.strokes).toHaveLength(strokesBefore)
  })

  it('客户端镜像不自行裁剪：权威推送多少条就保留多少条', () => {
    const scenario = enterDrawing()
    const { game, room } = scenario
    const limit = APP_CONFIG.drawing.maxHistoryCommands
    const nextSequence = fillHistoryToCap(scenario)
    const client = createClientMirror(scenario)
    client.applyPushes()
    expect(client.strokes).toHaveLength(limit)

    // 直接投递一条超出上限的权威推送：镜像必须完整保留，容量语义只由服务端裁决。
    client.roomSync.onStroke(
      {
        roomId: room.id,
        gameId: game.id,
        roundId: game.roundId,
        drawingRevision: game.drawingRevision + 1,
      },
      dotStroke(nextSequence, limit + 1),
    )

    expect(client.strokes).toHaveLength(limit + 1)
    expect(client.strokes[0]?.id).toBe(BOUNDARY_ID)
  })
})
