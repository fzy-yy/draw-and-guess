import { describe, expect, it } from 'vitest'
import type { FillCommand, Stroke } from '@draw-guess/shared'
import {
  applyFill,
  applyStroke,
  clearCanvas,
  redoCommand,
  undoCommand,
  type DrawingBudget,
  type DrawingCanvasState,
} from '../../apps/server/src/domain/drawing/drawing-core.ts'

/**
 * 绘图纯函数内核的不变量（S49 / ADR-0010）。
 *
 * 每个用例只断言内核的**外部可观察行为**：给定画布状态 + 命令 + 预算，得到新状态或拒绝原因。
 * 期望值全部是手算样例（预算、点数与序号在用例内显式写出），不调用内核自身重算，
 * 也不复用被测实现的规范化函数——颜色期望值直接写大写形式。
 * 内核不依赖房间/成员/传输：这里的画布状态就是普通对象，同步游标与发布策略不参与。
 */

/** 画布状态试样：只写内核需要的最小字段；空画布的序号基线是 -1（第一条合法命令从 0 开始）。 */
function canvasState(patch: Partial<DrawingCanvasState> = {}): DrawingCanvasState {
  return {
    strokes: [],
    undoneStrokeIds: [],
    lastSequence: -1,
    strokePointTotal: 0,
    fillCount: 0,
    drawingRevision: 0,
    ...patch,
  }
}

/** 预算试样：默认足够宽松，各用例只覆盖自己要观察的那一档（数值为手写样例）。 */
function budget(patch: Partial<DrawingBudget> = {}): DrawingBudget {
  return {
    maxHistoryCommands: 8,
    maxPointsPerRound: 20,
    maxPointsPerStroke: 6,
    maxFillsPerRound: 4,
    ...patch,
  }
}

function point(x: number, y: number) {
  return { x, y }
}

/** 笔画试样：小写颜色用于观察规范化，默认单点、序号 0。 */
function stroke(patch: Partial<Stroke> = {}): Stroke {
  return {
    kind: 'stroke',
    id: 'stroke-1',
    tool: 'pen',
    color: '#1f2937',
    width: 5,
    sequence: 0,
    startPointIndex: 0,
    points: [point(0.1, 0.1)],
    ...patch,
  }
}

function fill(patch: Partial<FillCommand> = {}): FillCommand {
  return {
    kind: 'fill',
    id: 'fill-1',
    point: point(0.2, 0.2),
    color: '#ef4444',
    sequence: 0,
    ...patch,
  }
}

/** 取历史里的第 index 条笔画命令；不是笔画即用例失败（免去在断言里写类型断言）。 */
function storedStroke(canvas: DrawingCanvasState, index: number): Stroke {
  const command = canvas.strokes[index]
  if (command?.kind !== 'stroke') throw new Error(`历史第 ${index} 条不是笔画命令`)
  return command
}

describe('笔画进入权威历史', () => {
  it('接受新笔画：写入历史、推进序号与修订代次，并回报累计点数与剩余预算', () => {
    const canvas = canvasState()
    const decision = applyStroke(
      canvas,
      stroke({ points: [point(0.1, 0.1), point(0.2, 0.2)], sequence: 0 }),
      budget(),
    )
    if (!decision.accepted) throw new Error(`期望接受，实际拒绝：${decision.reason}`)

    expect(canvas.strokes.map((command) => command.id)).toEqual(['stroke-1'])
    // 颜色规范化（小写 → 大写）后写入权威历史。
    expect(canvas.strokes[0]).toMatchObject({ color: '#1F2937', sequence: 0 })
    expect(canvas.lastSequence).toBe(0)
    expect(canvas.strokePointTotal).toBe(2) // 手算：这一笔 2 个点
    expect(canvas.fillCount).toBe(0)
    expect(canvas.drawingRevision).toBe(1)
    expect(decision.value.pointCount).toBe(2)
    expect(decision.value.remainingBudget).toBe(18) // 手算：20 - 2
  })

  it('序号不前进的命令按旧包拒绝，画布状态原样保留', () => {
    const canvas = canvasState({ lastSequence: 4, drawingRevision: 7 })
    const decision = applyStroke(canvas, stroke({ sequence: 4 }), budget())
    if (decision.accepted) throw new Error('期望拒绝，实际接受')

    expect(decision.reason).toBe('stale-sequence')
    expect(canvas.strokes).toHaveLength(0)
    expect(canvas.lastSequence).toBe(4)
    expect(canvas.drawingRevision).toBe(7)
  })

  it('同 id 的续接批次只补点：不新增命令、点数累计、ack 回报累计点数', () => {
    const canvas = canvasState()
    const opened = applyStroke(
      canvas,
      stroke({ id: 'stroke-a', points: [point(0.1, 0.1), point(0.2, 0.2)], sequence: 0 }),
      budget(),
    )
    if (!opened.accepted) throw new Error(`期望接受，实际拒绝：${opened.reason}`)

    // 起笔编号等于既有命令点数，颜色大小写不同（规范化后一致）也视为同一风格。
    const continued = applyStroke(
      canvas,
      stroke({
        id: 'stroke-a',
        color: '#1F2937',
        points: [point(0.3, 0.3)],
        sequence: 1,
        startPointIndex: 2,
      }),
      budget(),
    )
    if (!continued.accepted) throw new Error(`期望接受，实际拒绝：${continued.reason}`)

    expect(canvas.strokes).toHaveLength(1)
    expect(storedStroke(canvas, 0).points).toHaveLength(3)
    expect(canvas.strokePointTotal).toBe(3) // 手算：2 + 1
    expect(canvas.lastSequence).toBe(1)
    expect(canvas.drawingRevision).toBe(2)
    expect(continued.value.pointCount).toBe(3)
  })

  it('续接批次的线宽、颜色或起笔编号与既有命令不一致时按非法样式拒绝，历史不补点', () => {
    const canvas = canvasState()
    const opened = applyStroke(
      canvas,
      stroke({ id: 'stroke-a', width: 5, points: [point(0.1, 0.1), point(0.2, 0.2)], sequence: 0 }),
      budget(),
    )
    if (!opened.accepted) throw new Error(`期望接受，实际拒绝：${opened.reason}`)

    const decisions = [
      applyStroke(
        canvas,
        stroke({
          id: 'stroke-a',
          width: 9,
          sequence: 1,
          startPointIndex: 2,
          points: [point(0.3, 0.3)],
        }),
        budget(),
      ),
      applyStroke(
        canvas,
        stroke({
          id: 'stroke-a',
          color: '#ef4444',
          sequence: 1,
          startPointIndex: 2,
          points: [point(0.3, 0.3)],
        }),
        budget(),
      ),
      applyStroke(
        canvas,
        stroke({ id: 'stroke-a', sequence: 1, startPointIndex: 1, points: [point(0.3, 0.3)] }),
        budget(),
      ),
    ]
    for (const decision of decisions) {
      if (decision.accepted) throw new Error('期望拒绝，实际接受')
      expect(decision.reason).toBe('invalid-style')
    }
    expect(storedStroke(canvas, 0).points).toHaveLength(2)
    expect(canvas.strokePointTotal).toBe(2)
    expect(canvas.lastSequence).toBe(0)
  })

  it('新命令的起笔编号只能缺省或为 0，否则按非法样式拒绝', () => {
    const outOfRange = applyStroke(canvasState(), stroke({ startPointIndex: 1 }), budget())
    if (outOfRange.accepted) throw new Error('期望拒绝，实际接受')
    expect(outOfRange.reason).toBe('invalid-style')

    // 缺省起点按「整笔新命令」处理，可以正常入历史。
    const omitted = applyStroke(canvasState(), stroke({ startPointIndex: undefined }), budget())
    expect(omitted.accepted).toBe(true)
  })

  it('达到命令数上限后拒绝新增，最旧命令仍在权威历史里', () => {
    const canvas = canvasState()
    const limits = budget({ maxHistoryCommands: 2, maxPointsPerRound: 50 })
    for (const [index, id] of ['stroke-a', 'stroke-b'].entries()) {
      const decision = applyStroke(canvas, stroke({ id, sequence: index }), limits)
      if (!decision.accepted) throw new Error(`期望接受，实际拒绝：${decision.reason}`)
    }

    const overflow = applyStroke(canvas, stroke({ id: 'stroke-c', sequence: 2 }), limits)
    if (overflow.accepted) throw new Error('期望拒绝，实际接受')
    expect(overflow.reason).toBe('history-limit-reached')
    // 手算：上限 2，最旧两条原样保留（拒绝新增而非丢弃最旧，见 ADR-0010）。
    expect(canvas.strokes.map((command) => command.id)).toEqual(['stroke-a', 'stroke-b'])
    expect(canvas.lastSequence).toBe(1)
    expect(canvas.drawingRevision).toBe(2)
  })

  it('历史满员时续接批次仍可补点，不占新命令名额', () => {
    const canvas = canvasState()
    const limits = budget({ maxHistoryCommands: 1, maxPointsPerRound: 20, maxPointsPerStroke: 6 })
    const opened = applyStroke(
      canvas,
      stroke({ id: 'stroke-a', points: [point(0.1, 0.1), point(0.2, 0.2)], sequence: 0 }),
      limits,
    )
    if (!opened.accepted) throw new Error(`期望接受，实际拒绝：${opened.reason}`)

    const continued = applyStroke(
      canvas,
      stroke({ id: 'stroke-a', points: [point(0.3, 0.3)], sequence: 1, startPointIndex: 2 }),
      limits,
    )
    if (!continued.accepted) throw new Error(`期望接受，实际拒绝：${continued.reason}`)
    expect(canvas.strokes).toHaveLength(1)
    expect(canvas.strokePointTotal).toBe(3)
  })

  it('被撤销的命令在新命令落地时从历史剔除并释放名额与点数', () => {
    const canvas = canvasState({
      strokes: [stroke({ id: 'stroke-a', sequence: 0 }), stroke({ id: 'stroke-b', sequence: 1 })],
      undoneStrokeIds: ['stroke-b'],
      lastSequence: 1,
      strokePointTotal: 2,
      drawingRevision: 3,
    })
    const decision = applyStroke(
      canvas,
      stroke({ id: 'stroke-c', sequence: 2 }),
      budget({ maxHistoryCommands: 2 }),
    )
    if (!decision.accepted) throw new Error(`期望接受，实际拒绝：${decision.reason}`)

    expect(canvas.strokes.map((command) => command.id)).toEqual(['stroke-a', 'stroke-c'])
    expect(canvas.undoneStrokeIds).toEqual([])
    expect(canvas.strokePointTotal).toBe(2) // 手算：2 - 1（释放被撤销命令）+ 1（新命令）
    expect(canvas.lastSequence).toBe(2)
    expect(canvas.drawingRevision).toBe(4)
  })

  it('整幅画的点数预算用尽后拒绝新增，点数与历史保持不变', () => {
    const canvas = canvasState()
    const limits = budget({ maxPointsPerRound: 2 })
    const opened = applyStroke(
      canvas,
      stroke({ id: 'stroke-a', points: [point(0.1, 0.1), point(0.2, 0.2)], sequence: 0 }),
      limits,
    )
    if (!opened.accepted) throw new Error(`期望接受，实际拒绝：${opened.reason}`)

    const overflow = applyStroke(canvas, stroke({ id: 'stroke-b', sequence: 1 }), limits)
    if (overflow.accepted) throw new Error('期望拒绝，实际接受')
    expect(overflow.reason).toBe('budget-exceeded')
    expect(canvas.strokes.map((command) => command.id)).toEqual(['stroke-a'])
    expect(canvas.strokePointTotal).toBe(2)
    expect(canvas.lastSequence).toBe(0)
    expect(canvas.drawingRevision).toBe(1)
  })

  it('单笔点数预算用尽后拒绝续接，既有命令点数不变', () => {
    const canvas = canvasState()
    const limits = budget({ maxPointsPerStroke: 2 })
    const opened = applyStroke(
      canvas,
      stroke({ id: 'stroke-a', points: [point(0.1, 0.1), point(0.2, 0.2)], sequence: 0 }),
      limits,
    )
    if (!opened.accepted) throw new Error(`期望接受，实际拒绝：${opened.reason}`)

    const continued = applyStroke(
      canvas,
      stroke({ id: 'stroke-a', points: [point(0.3, 0.3)], sequence: 1, startPointIndex: 2 }),
      limits,
    )
    if (continued.accepted) throw new Error('期望拒绝，实际接受')
    expect(continued.reason).toBe('budget-exceeded')
    expect(storedStroke(canvas, 0).points).toHaveLength(2)
    expect(canvas.strokePointTotal).toBe(2)
  })

  it('拒绝顺序确定：旧包与非法样式先于历史上限裁决', () => {
    const canvas = canvasState({
      strokes: [stroke({ id: 'stroke-a', sequence: 0 }), stroke({ id: 'stroke-b', sequence: 1 })],
      lastSequence: 1,
      strokePointTotal: 2,
      drawingRevision: 2,
    })
    const limits = budget({ maxHistoryCommands: 2 })

    const stale = applyStroke(canvas, stroke({ id: 'stroke-c', sequence: 1 }), limits)
    if (stale.accepted) throw new Error('期望拒绝，实际接受')
    expect(stale.reason).toBe('stale-sequence')

    const badStyle = applyStroke(
      canvas,
      stroke({ id: 'stroke-c', sequence: 2, startPointIndex: 3 }),
      limits,
    )
    if (badStyle.accepted) throw new Error('期望拒绝，实际接受')
    expect(badStyle.reason).toBe('invalid-style')

    const overflow = applyStroke(canvas, stroke({ id: 'stroke-c', sequence: 2 }), limits)
    if (overflow.accepted) throw new Error('期望拒绝，实际接受')
    expect(overflow.reason).toBe('history-limit-reached')
    expect(canvas.strokes.map((command) => command.id)).toEqual(['stroke-a', 'stroke-b'])
  })
})

describe('填充进入权威历史', () => {
  it('接受填充：写入历史、点数与填充次数各加一，颜色规范化', () => {
    const canvas = canvasState({ lastSequence: 3, strokePointTotal: 5, drawingRevision: 2 })
    const decision = applyFill(canvas, fill({ sequence: 4 }), budget())
    if (!decision.accepted) throw new Error(`期望接受，实际拒绝：${decision.reason}`)

    expect(canvas.strokes.map((command) => command.id)).toEqual(['fill-1'])
    expect(canvas.strokes[0]).toMatchObject({ kind: 'fill', color: '#EF4444' })
    expect(decision.value.command).toMatchObject({ id: 'fill-1', color: '#EF4444' })
    expect(canvas.lastSequence).toBe(4)
    expect(canvas.strokePointTotal).toBe(6) // 手算：填充按 1 个点计
    expect(canvas.fillCount).toBe(1)
    expect(canvas.drawingRevision).toBe(3)
  })

  it('序号不前进的填充按旧包拒绝，点数与填充次数不变', () => {
    const canvas = canvasState({
      lastSequence: 4,
      strokePointTotal: 5,
      fillCount: 2,
      drawingRevision: 7,
    })
    const decision = applyFill(canvas, fill({ sequence: 4 }), budget())
    if (decision.accepted) throw new Error('期望拒绝，实际接受')

    expect(decision.reason).toBe('stale-sequence')
    expect(canvas.strokes).toHaveLength(0)
    expect(canvas.strokePointTotal).toBe(5)
    expect(canvas.fillCount).toBe(2)
    expect(canvas.lastSequence).toBe(4)
    expect(canvas.drawingRevision).toBe(7)
  })

  it('命令数达到上限后拒绝新填充，既有历史保持不变', () => {
    const canvas = canvasState({
      strokes: [{ ...fill({ id: 'fill-0', sequence: 0 }), color: '#EF4444' }],
      lastSequence: 0,
      strokePointTotal: 1,
      fillCount: 1,
      drawingRevision: 1,
    })
    const decision = applyFill(
      canvas,
      fill({ id: 'fill-1', sequence: 1 }),
      budget({ maxHistoryCommands: 1 }),
    )
    if (decision.accepted) throw new Error('期望拒绝，实际接受')

    expect(decision.reason).toBe('history-limit-reached')
    expect(canvas.strokes.map((command) => command.id)).toEqual(['fill-0'])
    expect(canvas.fillCount).toBe(1)
  })

  it('点数预算用尽后拒绝填充，历史与计数保持不变', () => {
    const canvas = canvasState()
    const decision = applyFill(canvas, fill({ sequence: 0 }), budget({ maxPointsPerRound: 0 }))
    if (decision.accepted) throw new Error('期望拒绝，实际接受')

    expect(decision.reason).toBe('budget-exceeded')
    expect(canvas.strokes).toHaveLength(0)
    expect(canvas.strokePointTotal).toBe(0)
    expect(canvas.fillCount).toBe(0)
  })

  it('填充次数预算用尽后拒绝填充，历史保持不变', () => {
    const canvas = canvasState({
      strokes: [
        { ...fill({ id: 'fill-0', sequence: 0 }), color: '#EF4444' },
        { ...fill({ id: 'fill-1', sequence: 1 }), color: '#EF4444' },
      ],
      lastSequence: 1,
      strokePointTotal: 2,
      fillCount: 2,
      drawingRevision: 2,
    })
    const decision = applyFill(
      canvas,
      fill({ id: 'fill-2', sequence: 2 }),
      budget({ maxFillsPerRound: 2 }),
    )
    if (decision.accepted) throw new Error('期望拒绝，实际接受')

    expect(decision.reason).toBe('budget-exceeded')
    expect(canvas.strokes.map((command) => command.id)).toEqual(['fill-0', 'fill-1'])
    expect(canvas.fillCount).toBe(2)
  })

  it('被撤销的填充在新填充落地时从历史剔除并释放填充名额', () => {
    const canvas = canvasState({
      strokes: [
        { ...fill({ id: 'fill-0', sequence: 0 }), color: '#EF4444' },
        { ...fill({ id: 'fill-1', sequence: 1 }), color: '#EF4444' },
      ],
      undoneStrokeIds: ['fill-1'],
      lastSequence: 1,
      strokePointTotal: 2,
      fillCount: 2,
      drawingRevision: 3,
    })
    const decision = applyFill(
      canvas,
      fill({ id: 'fill-2', sequence: 2 }),
      budget({ maxFillsPerRound: 2 }),
    )
    if (!decision.accepted) throw new Error(`期望接受，实际拒绝：${decision.reason}`)

    expect(canvas.strokes.map((command) => command.id)).toEqual(['fill-0', 'fill-2'])
    expect(canvas.undoneStrokeIds).toEqual([])
    expect(canvas.fillCount).toBe(2) // 手算：2 - 1（释放被撤销的填充）+ 1
    expect(canvas.strokePointTotal).toBe(2)
  })
})

describe('撤销、重做与清空', () => {
  it('撤销标记最后一条命令：历史只增不删、序号与预算不变，只推进修订代次', () => {
    const canvas = canvasState({
      strokes: [stroke({ id: 'stroke-a', sequence: 0 }), stroke({ id: 'stroke-b', sequence: 1 })],
      lastSequence: 1,
      strokePointTotal: 2,
      drawingRevision: 2,
    })
    expect(undoCommand(canvas)).toBe(true)

    expect(canvas.undoneStrokeIds).toEqual(['stroke-b'])
    expect(canvas.strokes.map((command) => command.id)).toEqual(['stroke-a', 'stroke-b'])
    expect(canvas.lastSequence).toBe(1)
    expect(canvas.strokePointTotal).toBe(2) // 预算只在被撤销命令被新命令剔除时释放
    expect(canvas.drawingRevision).toBe(3)
  })

  it('撤销跳过已撤销命令，撤销栈按先进后出累积', () => {
    const canvas = canvasState({
      strokes: [stroke({ id: 'stroke-a', sequence: 0 }), stroke({ id: 'stroke-b', sequence: 1 })],
      undoneStrokeIds: ['stroke-b'],
      lastSequence: 1,
      strokePointTotal: 2,
      drawingRevision: 3,
    })
    expect(undoCommand(canvas)).toBe(true)

    expect(canvas.undoneStrokeIds).toEqual(['stroke-b', 'stroke-a'])
    expect(canvas.drawingRevision).toBe(4)
  })

  it('没有可撤销命令时为无变化，不推进修订代次', () => {
    const canvas = canvasState({
      strokes: [stroke({ id: 'stroke-a', sequence: 0 })],
      undoneStrokeIds: ['stroke-a'],
      lastSequence: 0,
      strokePointTotal: 1,
      drawingRevision: 5,
    })
    expect(undoCommand(canvas)).toBe(false)

    expect(canvas.undoneStrokeIds).toEqual(['stroke-a'])
    expect(canvas.drawingRevision).toBe(5)
  })

  it('重做弹出撤销栈顶；栈空时为无变化', () => {
    const canvas = canvasState({ undoneStrokeIds: ['stroke-b', 'stroke-a'], drawingRevision: 2 })
    expect(redoCommand(canvas)).toBe(true)
    expect(canvas.undoneStrokeIds).toEqual(['stroke-b'])
    expect(canvas.drawingRevision).toBe(3)

    expect(redoCommand(canvas)).toBe(true)
    expect(canvas.undoneStrokeIds).toEqual([])
    expect(canvas.drawingRevision).toBe(4)

    expect(redoCommand(canvas)).toBe(false)
    expect(canvas.drawingRevision).toBe(4)
  })

  it('清空重置历史与全部预算，并推进序号让在途旧包作废', () => {
    const canvas = canvasState({
      strokes: [
        stroke({ id: 'stroke-a', sequence: 3 }),
        { ...fill({ id: 'fill-1', sequence: 4 }), color: '#EF4444' },
      ],
      undoneStrokeIds: ['fill-1'],
      lastSequence: 9,
      strokePointTotal: 7,
      fillCount: 3,
      drawingRevision: 11,
    })
    expect(clearCanvas(canvas)).toBe(true)

    expect(canvas.strokes).toEqual([])
    expect(canvas.undoneStrokeIds).toEqual([])
    expect(canvas.strokePointTotal).toBe(0)
    expect(canvas.fillCount).toBe(0)
    expect(canvas.lastSequence).toBe(10) // 手算：9 + 1
    expect(canvas.drawingRevision).toBe(12)
  })

  it('空画布清空无变化，不改动序号与修订代次', () => {
    const canvas = canvasState({ lastSequence: 4, drawingRevision: 2 })
    expect(clearCanvas(canvas)).toBe(false)

    expect(canvas.lastSequence).toBe(4)
    expect(canvas.drawingRevision).toBe(2)
  })
})
