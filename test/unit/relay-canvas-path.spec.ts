/**
 * 接龙画布写入通路（S2 / S45 / S49 / S53）。
 *
 * 断言口径（只用外部可观察行为）：
 * - 本棒期间对房间**零推送**：同一房间内其他玩家在画作交接给他们之前收不到任何一笔，
 *   命令只写进本棒链的权威历史；
 * - 每幅画独立计数（命令 / 点数 / 填充三档预算），第一幅满不累及第二幅；
 * - 越权 / 过期步骤 / 非作画棒以既有错误码拒绝，且不改动画布；
 * - 撤销 / 重做 / 清空的语义与经典一致；清空重置预算并推进序号（在途旧包作废）；
 * - ack 与经典绘图同形（笔画批带修订号 / 点数 / 剩余预算，填充只带修订号）。
 * 期望值全部是协议常量与手算样例，不用被测实现复算。
 */
import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import {
  CLIENT_RESPONSE_SCHEMAS,
  ERROR_CODES,
  EVENTS,
  type FillCommand,
  type Stroke,
} from '@draw-guess/shared'
import { serverErrorMessages } from '@draw-guess/strings'
import type { DrawingCanvasState } from '../../apps/server/src/domain/drawing/drawing-core.ts'
import { startRelayDrawing, type RelayDrawingScenario } from './helpers/relay-game-fixture.ts'

/** 每条命令之间推进 25ms 假时钟（40 命令/秒 < 45 的绘图限频），与经典绘图用例同口径。 */
const COMMAND_STEP_MS = 25

const REQUEST_ID = '00000000-0000-4000-8000-0000000000ff'

/**
 * 真实返回值必须同时通过该事件的响应边界：接龙绘图 ack 与经典共用同一批 Schema
 *（工单 02 定稿），这里用真实服务端输出兜底，防止「实现漂移出线格式」。
 */
function expectAckBoundary(event: keyof typeof CLIENT_RESPONSE_SCHEMAS, data: unknown): void {
  const parsed = CLIENT_RESPONSE_SCHEMAS[event].safeParse({
    ok: true,
    data,
    requestId: REQUEST_ID,
  })
  expect(parsed.success, `${event} 的真实响应未通过响应 Schema`).toBe(true)
}

/** 单点笔画：一条命令只占 1 个点，便于把命令数与点数预算精确推到上限。 */
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

/** 多点笔画：用于观察 ack 的 pointCount 与剩余预算。 */
function polylineStroke(sequence: number, id: string, pointCount: number): Stroke {
  return {
    ...dotStroke(sequence, 0),
    id,
    points: Array.from({ length: pointCount }, (_, index) => ({
      x: 0.1 + index * 0.05,
      y: 0.2,
    })),
  }
}

function fillCommand(sequence: number): FillCommand {
  return {
    kind: 'fill',
    id: `fill-${sequence}`,
    point: { x: 0.2, y: 0.5 },
    color: '#EF4444',
    sequence,
  }
}

function addStroke(
  scenario: RelayDrawingScenario,
  playerId: string,
  stroke: Stroke,
  stepId: string = scenario.stepId,
) {
  scenario.harness.runtime.jump(COMMAND_STEP_MS)
  return scenario.harness.service.addRelayStroke(playerId, stepId, stroke)
}

function addFill(
  scenario: RelayDrawingScenario,
  playerId: string,
  fill: FillCommand,
  stepId: string = scenario.stepId,
) {
  scenario.harness.runtime.jump(COMMAND_STEP_MS)
  return scenario.harness.service.addRelayFill(playerId, stepId, fill)
}

/**
 * 把一幅画布的命令数精确推到上限（手算样例：直接预置历史与序号，隔离「上限裁决」本身）。
 * 占位命令用独立 id（`filler-*`），避免与随后用例真正写入的命令 id 撞车而被判成续接批次。
 * 点数、填充次数与修订号一并对齐，保证拒绝原因只可能是命令数上限。
 */
function fillCanvasToCommandLimit(canvas: DrawingCanvasState): void {
  const limit = APP_CONFIG.drawing.maxHistoryCommands
  canvas.strokes = Array.from({ length: limit }, (_, index) => ({
    ...dotStroke(index, index),
    id: `filler-${index}`,
  }))
  canvas.lastSequence = limit - 1
  canvas.strokePointTotal = limit
  canvas.drawingRevision = limit
}

describe('接龙画布写入通路', () => {
  it('本棒期间对房间零推送：命令只写入本棒链的权威历史', () => {
    const scenario = startRelayDrawing()
    const drawer = scenario.players[0]
    if (!drawer) throw new Error('场景缺少玩家')
    const pushBaseline = scenario.harness.ioEvents.length
    const socketBaselines = scenario.players.map((player) => player.socket.events.length)

    // 五种命令全部走一遍：笔画（1 修订）→ 填充（2）→ 撤销（3）→ 重做（4）→ 清空（5）→ 笔画（6）。
    addStroke(scenario, drawer.playerId, polylineStroke(0, 'stroke-0', 2))
    addFill(scenario, drawer.playerId, fillCommand(1))
    scenario.harness.service.relayUndo(drawer.playerId, scenario.stepId)
    scenario.harness.service.relayRedo(drawer.playerId, scenario.stepId)
    scenario.harness.service.relayClear(drawer.playerId, scenario.stepId)
    // 清空把序号推进到 2（-1 → 0 → 1 → 2），因此重新起笔从 3 开始。
    addStroke(scenario, drawer.playerId, dotStroke(3, 3))

    // 权威历史确实前移：清空之后只剩新笔画，序号与修订代次按手算样例推进。
    const canvas = scenario.canvasOf(drawer.playerId, 1)
    expect(canvas.strokes.map((command) => command.id)).toEqual(['stroke-3'])
    expect(canvas.lastSequence).toBe(3)
    expect(canvas.drawingRevision).toBe(6)

    // 房间级推送（广播 + 直连快照）一条都没有：其他玩家在交接前收不到任何一笔。
    expect(scenario.harness.ioEvents.slice(pushBaseline)).toEqual([])
    scenario.players.forEach((player, index) => {
      expect(player.socket.events.slice(socketBaselines[index] ?? 0)).toEqual([])
    })
  })

  it('同一房间内各画各自的链：命令只进本棒链的画布，互不串台', () => {
    const scenario = startRelayDrawing()
    const [first, second] = scenario.players
    if (!first || !second) throw new Error('场景缺少玩家')

    addStroke(scenario, first.playerId, dotStroke(0, 0))
    addStroke(scenario, second.playerId, dotStroke(0, 1))

    const firstCanvas = scenario.canvasOf(first.playerId, 1)
    const secondCanvas = scenario.canvasOf(second.playerId, 1)
    expect(firstCanvas.strokes.map((command) => command.id)).toEqual(['stroke-0'])
    expect(secondCanvas.strokes.map((command) => command.id)).toEqual(['stroke-1'])
    expect(firstCanvas.drawingRevision).toBe(1)
    expect(secondCanvas.drawingRevision).toBe(1)
  })

  it('笔画批次与填充的 ack 与经典同形：修订号 / 点数 / 剩余预算', () => {
    const scenario = startRelayDrawing()
    const drawer = scenario.players[0]
    if (!drawer) throw new Error('场景缺少玩家')

    // 期望值 = 协议配置常量 - 本次点数（手算），续接批次只补点、不新增命令。
    const firstAck = addStroke(scenario, drawer.playerId, polylineStroke(0, 'stroke-0', 3))
    expect(firstAck).toEqual({
      strokeId: 'stroke-0',
      pointCount: 3,
      drawingRevision: 1,
      remainingBudget: APP_CONFIG.drawing.maxPointsPerRound - 3,
    })
    expectAckBoundary(EVENTS.relayDrawStrokeBatch, firstAck)
    const continuationAck = addStroke(scenario, drawer.playerId, {
      ...polylineStroke(1, 'stroke-0', 2),
      startPointIndex: 3,
    })
    expect(continuationAck).toEqual({
      strokeId: 'stroke-0',
      pointCount: 5,
      drawingRevision: 2,
      remainingBudget: APP_CONFIG.drawing.maxPointsPerRound - 5,
    })
    expectAckBoundary(EVENTS.relayDrawStrokeBatch, continuationAck)
    const fillAck = addFill(scenario, drawer.playerId, fillCommand(2))
    expect(fillAck).toEqual({ drawingRevision: 3 })
    expectAckBoundary(EVENTS.relayDrawFillCommit, fillAck)
    expect(scenario.canvasOf(drawer.playerId, 1).strokes).toHaveLength(2)
  })

  it('过期步骤 id 与非作画棒以既有错误码拒绝，画布保持原样', () => {
    const scenario = startRelayDrawing()
    const drawer = scenario.players[0]
    if (!drawer) throw new Error('场景缺少玩家')
    const canvas = scenario.canvasOf(drawer.playerId, 1)
    const staleStepId = '00000000-0000-4000-8000-0000000000d1'

    // 旧包（含上一棒残留）：按过期绘图包拒绝，客户端据此重新同步。
    expect(() =>
      scenario.harness.service.addRelayStroke(drawer.playerId, staleStepId, dotStroke(0, 0)),
    ).toThrow(serverErrorMessages[ERROR_CODES.STALE_DRAW_EVENT])

    // 猜词棒不允许作画（当前步骤不是作画棒）。
    scenario.moveTo({ step: 2, phase: 'relay_guess' })
    expect(() =>
      scenario.harness.service.addRelayStroke(drawer.playerId, scenario.stepId, dotStroke(0, 0)),
    ).toThrow(serverErrorMessages[ERROR_CODES.NOT_DRAWER])
    expect(() =>
      scenario.harness.service.addRelayFill(drawer.playerId, scenario.stepId, fillCommand(0)),
    ).toThrow(serverErrorMessages[ERROR_CODES.NOT_DRAWER])

    // 本棒倒计时结束：与经典一致按 PHASE_EXPIRED 拒绝（代交归工单 06，画布内容不动）。
    scenario.moveTo({ step: 1, phase: 'relay_draw' })
    scenario.harness.runtime.jump(APP_CONFIG.relay.drawSeconds.default * 1_000)
    expect(() =>
      scenario.harness.service.addRelayStroke(drawer.playerId, scenario.stepId, dotStroke(0, 0)),
    ).toThrow(serverErrorMessages[ERROR_CODES.PHASE_EXPIRED])

    // 被拒绝的命令不触碰任何画布状态。
    expect(canvas.strokes).toEqual([])
    expect(canvas.lastSequence).toBe(-1)
    expect(canvas.drawingRevision).toBe(0)
  })

  it('不在本局链阵容中的成员（残留连接）无法作画', () => {
    // 开局门禁不允许中途入座（S36），因此越权用例用「在房里但没分到链」的成员构造：
    // 他们不满足 (观看者, stepId) → 本棒链画布的解析，服务端必须按越权拒绝。
    const scenario = startRelayDrawing({ unseatedCount: 1 })
    const outsider = scenario.unseated[0]
    if (!outsider) throw new Error('场景缺少未入座成员')
    expect(scenario.players.map((player) => player.playerId)).not.toContain(outsider.playerId)

    expect(() =>
      scenario.harness.service.addRelayStroke(outsider.playerId, scenario.stepId, dotStroke(0, 0)),
    ).toThrow(serverErrorMessages[ERROR_CODES.NOT_DRAWER])
    expect(() => scenario.harness.service.relayClear(outsider.playerId, scenario.stepId)).toThrow(
      serverErrorMessages[ERROR_CODES.NOT_DRAWER],
    )
  })

  it('每幅画的预算独立计数：第一幅满不累及第二幅', () => {
    const scenario = startRelayDrawing()
    const drawer = scenario.players[0]
    if (!drawer) throw new Error('场景缺少玩家')

    // 第一幅：命令数精确推到上限（ADR-0010：拒绝新增，不丢最旧）。
    const firstCanvas = scenario.canvasOf(drawer.playerId, 1)
    const limit = APP_CONFIG.drawing.maxHistoryCommands
    fillCanvasToCommandLimit(firstCanvas)
    expect(() => addStroke(scenario, drawer.playerId, dotStroke(limit, 0))).toThrow(
      serverErrorMessages[ERROR_CODES.DRAW_HISTORY_LIMIT_REACHED],
    )
    // 同一玩家第一幅的点数预算也推到上限：先腾出命令名额（隔离点数判定），填充仍被拒。
    firstCanvas.strokes = firstCanvas.strokes.slice(0, limit - 1)
    firstCanvas.strokePointTotal = APP_CONFIG.drawing.maxPointsPerRound
    expect(() => addFill(scenario, drawer.playerId, fillCommand(limit))).toThrow(
      serverErrorMessages[ERROR_CODES.DRAW_BUDGET_EXCEEDED],
    )

    // 第二幅（步 3 的链画布）预算从零起算：两笔真实命令都能写入。
    scenario.moveTo({ step: 3, phase: 'relay_draw' })
    const secondCanvas = scenario.canvasOf(drawer.playerId, 3)
    expect(secondCanvas).not.toBe(firstCanvas)
    const strokeAck = addStroke(scenario, drawer.playerId, polylineStroke(0, 'stroke-0', 2))
    const fillAck = addFill(scenario, drawer.playerId, fillCommand(1))
    expect(strokeAck.pointCount).toBe(2)
    expect(fillAck).toEqual({ drawingRevision: 2 })
    // 手算：2 点 + 填充 1 点 = 3 点，填充 1 次；第一幅仍停在自己的预置状态（计数没有串台）。
    expect(secondCanvas.strokePointTotal).toBe(3)
    expect(secondCanvas.fillCount).toBe(1)
    expect(firstCanvas.strokes).toHaveLength(limit - 1)
    expect(firstCanvas.fillCount).toBe(0)
  })

  it('撤销与重做沿用经典语义：撤销释放命令名额，重做恢复最近一次撤销', () => {
    const scenario = startRelayDrawing()
    const drawer = scenario.players[0]
    if (!drawer) throw new Error('场景缺少玩家')
    const canvas = scenario.canvasOf(drawer.playerId, 1)
    const limit = APP_CONFIG.drawing.maxHistoryCommands
    fillCanvasToCommandLimit(canvas)
    expect(() => addStroke(scenario, drawer.playerId, dotStroke(limit, 0))).toThrow(
      serverErrorMessages[ERROR_CODES.DRAW_HISTORY_LIMIT_REACHED],
    )

    // 撤销把最新命令标记为已撤销；下一条命令会先作废它，从而腾出名额（历史长度不变）。
    scenario.harness.service.relayUndo(drawer.playerId, scenario.stepId)
    addStroke(scenario, drawer.playerId, dotStroke(limit, 0))
    expect(canvas.strokes).toHaveLength(limit)

    // 重做：弹出撤销栈顶，命令重新生效（修订号前移，撤销栈清空）。
    const revisionBeforeUndo = canvas.drawingRevision
    scenario.harness.service.relayUndo(drawer.playerId, scenario.stepId)
    expect(canvas.undoneStrokeIds).toHaveLength(1)
    scenario.harness.service.relayRedo(drawer.playerId, scenario.stepId)
    expect(canvas.undoneStrokeIds).toEqual([])
    expect(canvas.drawingRevision).toBe(revisionBeforeUndo + 2)
  })

  it('清空重置预算并推进序号：在途旧包作废，空画布清空为无变化', () => {
    const scenario = startRelayDrawing()
    const drawer = scenario.players[0]
    if (!drawer) throw new Error('场景缺少玩家')
    const canvas = scenario.canvasOf(drawer.playerId, 1)

    addStroke(scenario, drawer.playerId, polylineStroke(0, 'stroke-0', 4))
    // 预置两档预算到上限（手算样例），验证清空确实重置了它们。
    canvas.strokePointTotal = APP_CONFIG.drawing.maxPointsPerRound
    canvas.fillCount = APP_CONFIG.drawing.maxFillsPerRound
    expect(() => addFill(scenario, drawer.playerId, fillCommand(1))).toThrow(
      serverErrorMessages[ERROR_CODES.DRAW_BUDGET_EXCEEDED],
    )

    scenario.harness.service.relayClear(drawer.playerId, scenario.stepId)
    expect(canvas.strokes).toEqual([])
    expect(canvas.undoneStrokeIds).toEqual([])
    expect(canvas.strokePointTotal).toBe(0)
    expect(canvas.fillCount).toBe(0)
    // 手算：序号 -1 → 0（笔画）→ 1（清空推进），修订号 1 → 2（清空）。
    expect(canvas.lastSequence).toBe(1)
    expect(canvas.drawingRevision).toBe(2)

    // 在途旧包被拒；预算已重置，填充与新序号笔画都能写入。
    expect(() => addStroke(scenario, drawer.playerId, dotStroke(0, 9))).toThrow(/过期|重复/)
    expect(addFill(scenario, drawer.playerId, fillCommand(2))).toEqual({ drawingRevision: 3 })
    expect(addStroke(scenario, drawer.playerId, dotStroke(3, 3))).toMatchObject({
      drawingRevision: 4,
      pointCount: 1,
    })

    // 空画布清空为无变化：先清空一次（修订 +1），再对空画布清空，修订号不再变化。
    scenario.harness.service.relayClear(drawer.playerId, scenario.stepId)
    expect(canvas.strokes).toEqual([])
    const revisionAfterClear = canvas.drawingRevision
    scenario.harness.service.relayClear(drawer.playerId, scenario.stepId)
    expect(canvas.drawingRevision).toBe(revisionAfterClear)
  })
})
