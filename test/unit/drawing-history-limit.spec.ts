import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { ERROR_CODES, EVENTS, type FillCommand, type Stroke } from '@draw-guess/shared'
import { serverErrorMessages } from '@draw-guess/strings'
import { createGameHarness, startTwoPlayerGame, type GameHarness } from './helpers/game-harness.ts'

/**
 * 绘图历史上限语义。
 *
 * 上限是「硬上限 + 拒绝新增」，不是「静默丢弃最旧命令」：FIFO 丢弃会让**早期封闭边界**
 * 悄悄消失，之后在边界内提交的填充在重放时会吞掉整张画布，且服务端权威历史与各客户端镜像
 * 不再逐条一致（见 docs/adr/0010-drawing-history-cap.md）。
 *
 * 每条命令之间推进 25ms 假时钟（40 命令/秒 < 45 的绘图限频），并保持在回合时长之内。
 */
const COMMAND_STEP_MS = 25
const BOUNDARY_ID = 'boundary-line'
const FILL_ID = 'fill-inside-boundary'

function enterDrawing() {
  const harness = createGameHarness()
  const state = startTwoPlayerGame(harness)
  const candidate = state.game.candidates[0]
  if (!candidate) throw new Error('测试词库未生成候选词')
  harness.backend.gameplay.chooseWord(state.game.drawerId, state.game.roundId, candidate.id)
  return { harness, ...state }
}

type Scenario = ReturnType<typeof enterDrawing>

/** 单点笔画：一条命令只占 1 个点，便于把命令数精确推到上限。 */
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

/**
 * 构造「早期封闭边界 + 后续填充」并把命令数精确推到上限：
 * 边界是一条竖直墨线，填充只覆盖左侧封闭区域——边界一旦丢失，同一条填充会吞掉整张画布。
 * 返回下一条可用的绘图序号。
 */
function fillHistoryToCap(scenario: Scenario): number {
  const limit = APP_CONFIG.drawing.maxHistoryCommands
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
  const fillerCount = limit - scenario.game.strokes.length
  for (let index = 0; index < fillerCount; index += 1) {
    addStroke(scenario, dotStroke(sequence++, index))
  }
  return sequence
}

function strokePushCount(harness: GameHarness): number {
  return harness.ioEvents.filter((event) => event.event === EVENTS.drawStrokeBatch).length
}

describe('绘图历史上限', () => {
  it('达到命令上限后拒绝新增，早期封闭边界与后续填充完整保留', () => {
    const scenario = enterDrawing()
    const { harness, game } = scenario
    const limit = APP_CONFIG.drawing.maxHistoryCommands
    const nextSequence = fillHistoryToCap(scenario)

    expect(game.strokes).toHaveLength(limit)
    expect(game.strokes[0]?.id).toBe(BOUNDARY_ID)
    expect(game.strokes[1]?.id).toBe(FILL_ID)

    // 超限命令被确定性拒绝：稳定错误码 + 中文安全文案，且不改动任何权威状态。
    const revisionBefore = game.drawingRevision
    const lastSequenceBefore = game.lastSequence
    const pushesBefore = strokePushCount(harness)
    expect(() => addStroke(scenario, dotStroke(nextSequence, limit + 1))).toThrow(
      serverErrorMessages[ERROR_CODES.DRAW_HISTORY_LIMIT_REACHED],
    )
    expect(() => addFill(scenario, fillCommand(nextSequence))).toThrow(
      serverErrorMessages[ERROR_CODES.DRAW_HISTORY_LIMIT_REACHED],
    )
    expect(game.strokes).toHaveLength(limit)
    expect(game.drawingRevision).toBe(revisionBefore)
    expect(game.lastSequence).toBe(lastSequenceBefore)
    expect(strokePushCount(harness)).toBe(pushesBefore)

    // 权威全量快照与增量历史一致：边界与填充都还在，且仍是最早的两条命令。
    const snapshot = harness.backend.publisher.snapshotForPlayer(game.drawerId, true)
    expect(snapshot?.game?.strokes).toHaveLength(limit)
    expect(snapshot?.game?.strokes?.[0]?.id).toBe(BOUNDARY_ID)
    expect(snapshot?.game?.strokes?.[1]?.id).toBe(FILL_ID)
  })

  it('上限不会吞掉撤销能力：撤销后立即释放一条可继续绘制的名额', () => {
    const scenario = enterDrawing()
    const { harness, game } = scenario
    const limit = APP_CONFIG.drawing.maxHistoryCommands
    const nextSequence = fillHistoryToCap(scenario)
    expect(game.strokes).toHaveLength(limit)

    // 撤销把最新命令标记为已撤销；下一条命令会先清理它，从而腾出名额（与提示文案一致）。
    harness.backend.drawing.classic.undo(game.drawerId, game.roundId)
    expect(() => addStroke(scenario, dotStroke(nextSequence, limit + 1))).not.toThrow()
    expect(game.strokes).toHaveLength(limit)
    expect(game.strokes.some((command) => command.id === BOUNDARY_ID)).toBe(true)
  })

  it('点数与填充次数预算继续独立裁决，被拒绝的命令不写入历史', () => {
    const scenario = enterDrawing()
    const { game } = scenario

    addStroke(scenario, dotStroke(0, 0))
    game.strokePointTotal = APP_CONFIG.drawing.maxPointsPerRound
    expect(() => addStroke(scenario, { ...dotStroke(1, 1), points: [{ x: 0.4, y: 0.4 }] })).toThrow(
      serverErrorMessages[ERROR_CODES.DRAW_BUDGET_EXCEEDED],
    )

    game.strokePointTotal = 0
    game.fillCount = APP_CONFIG.drawing.maxFillsPerRound
    expect(() => addFill(scenario, fillCommand(2))).toThrow(
      serverErrorMessages[ERROR_CODES.DRAW_BUDGET_EXCEEDED],
    )

    expect(game.strokes).toHaveLength(1)
  })

  it('拒绝顺序确定：旧包与非法样式先于历史上限裁决', () => {
    const scenario = enterDrawing()
    const { game } = scenario
    const nextSequence = fillHistoryToCap(scenario)

    expect(() => addStroke(scenario, dotStroke(0, 0))).toThrow(/过期|重复/)
    expect(() =>
      addStroke(scenario, { ...dotStroke(nextSequence, 99), color: 'not-a-color' }),
    ).toThrow(serverErrorMessages[ERROR_CODES.INVALID_DRAW_STYLE])
    expect(game.strokes).toHaveLength(APP_CONFIG.drawing.maxHistoryCommands)
  })
})
