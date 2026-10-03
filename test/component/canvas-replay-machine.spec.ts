import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrawingCommand, FillCommand } from '@draw-guess/shared'
import {
  DrawingReplayMachine,
  type FillComputePort,
  type PreviewStyle,
  type ReplaySnapshot,
} from '@/canvas/replay-machine'
import { FloodFillError } from '@/canvas/flood-fill-worker'
import { clearFillDiagnostics, getFillDiagnostics } from '@/canvas/fill-diagnostics'
import { makeFill, makeStroke } from '../client/canvas-stubs'

/**
 * 画布重放状态机的直接单测（ADR-0018）：以假填充端口 + 记录型画布替身驱动
 * 「快照同步 → 增量/整帧决策 → 后备缓冲 → 原子提交」的全部转移，不经过 Vue 组件。
 * e2e 09 的两类时序（填充在途被采样、重放被取代）在此钉死为毫秒级回归。
 */

const LOGICAL_WIDTH = 200
const LOGICAL_HEIGHT = 100
const ROUND = '00000000-0000-4000-8000-000000000001'
const PREVIEW_STYLE: PreviewStyle = { tool: 'pen', color: '#1F2937', width: 5 }

/** 记录型画布替身：element 元数据 + 单一 2D 上下文替身。 */
interface FakeCanvas {
  width: number
  height: number
  getContext: ReturnType<typeof vi.fn>
  context: CanvasRenderingContext2D
}

function createFakeCanvas(): FakeCanvas {
  const canvas = { width: 300, height: 150, getContext: vi.fn() } as unknown as FakeCanvas
  canvas.context = {
    canvas,
    globalCompositeOperation: 'source-over',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(
      (_x: number, _y: number, width: number, height: number) => new ImageData(width, height),
    ),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  canvas.getContext.mockReturnValue(canvas.context)
  return canvas
}

/**
 * 假填充端口：记录每次请求，resolve/reject 由用例显式控制，
 * 精确复现「在途 / 取消 / 故障 / 降级 / 零填充」五类时序。
 */
function createFillPort() {
  const requests: Array<{
    image: ImageData
    input: { roundId: string; startX: number; startY: number; tolerance: number }
  }> = []
  const pending: Array<{
    image: ImageData
    resolve: (result: { image: ImageData; filledPixels: number; degraded?: boolean }) => void
    reject: (error: Error) => void
  }> = []
  // 先以端口类型声明实现函数，再包 vi.fn：参数类型自动推导，Promise 泛型显式。
  const fillImpl: FillComputePort['fill'] = (image, input) => {
    requests.push({ image, input })
    return new Promise<{ image: ImageData; filledPixels: number; degraded?: boolean }>(
      (resolve, reject) => pending.push({ image, resolve, reject }),
    )
  }
  const port: FillComputePort = {
    fill: vi.fn(fillImpl),
    // 与真实 FloodFillWorkerClient 同语义：cancel 以「cancelled」拒绝所有在途任务——
    // 机器依赖这一点在世代取代时中止旧重放并走 cancelled（非故障）分支。
    cancel: vi.fn(() => {
      const tasks = pending.splice(0, pending.length)
      for (const task of tasks) task.reject(new FloodFillError('cancelled'))
    }),
  }
  function settle(count: number, handle: (task: (typeof pending)[number]) => void): void {
    for (let index = 0; index < count; index += 1) {
      const task = pending.shift()
      if (!task) throw new Error('机器未提交预期的填充任务')
      handle(task)
    }
  }
  return {
    port,
    requests,
    cancel: port.cancel,
    /** 完成前 count 个任务：把请求快照原样回写并报告填充像素数。 */
    complete: (count = 1, filledPixels = 64) =>
      settle(count, (task) => task.resolve({ image: task.image, filledPixels })),
    completeDegraded: (count = 1) =>
      settle(count, (task) =>
        task.resolve({ image: task.image, filledPixels: 64, degraded: true }),
      ),
    reject: (count: number, error: Error) => settle(count, (task) => task.reject(error)),
  }
}

/** 让机器内部 runReplay 的 await 链推进到当前可稳定的状态。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

/** 标准笔画工厂（形状单点在 test/client/canvas-stubs）。 */
const strokeCommand = makeStroke

/** 本 spec 的填充默认序号为 2（跟在首笔 sequence 1 之后）。 */
function fillCommand(overrides: Partial<FillCommand> = {}): FillCommand {
  return makeFill({ sequence: 2, ...overrides })
}

function snapshotOf(
  commands: DrawingCommand[],
  undoneIds: string[] = [],
  roundId = ROUND,
): ReplaySnapshot {
  return { commands, undoneIds, roundId }
}

const elementSpies: Array<{ mockRestore(): void }> = []

/**
 * 组装一台机器：document.createElement('canvas') 被替换为记录型画布，
 * 构造顺序（logical → scratch）决定 surfaces 的角色。
 */
function harness() {
  const fill = createFillPort()
  const present = vi.fn()
  const onRenderingChange = vi.fn()
  const onFillFailure = vi.fn()
  const surfaces: FakeCanvas[] = []
  const createElementSpy = vi.spyOn(document, 'createElement')
  elementSpies.push(createElementSpy)
  createElementSpy.mockImplementation(((tagName: string, ...rest: unknown[]) => {
    if (tagName === 'canvas') {
      const surface = createFakeCanvas()
      surfaces.push(surface)
      return surface as unknown as HTMLCanvasElement
    }
    return (
      createElementSpy as unknown as { wrappedMethod: typeof document.createElement }
    ).wrappedMethod.call(document, tagName as 'canvas', ...(rest as []))
  }) as typeof document.createElement)

  const machine = new DrawingReplayMachine(
    { present, onRenderingChange, onFillFailure },
    fill.port,
    { roundId: ROUND, undoCount: 0 },
  )

  const logical = surfaces[0]!.context
  const scratch = surfaces[1]!.context
  machine.resize(LOGICAL_WIDTH, LOGICAL_HEIGHT)
  return { machine, fill, present, onRenderingChange, onFillFailure, logical, scratch }
}

beforeEach(() => clearFillDiagnostics())
afterEach(() => {
  elementSpies.splice(0).forEach((spy) => spy.mockRestore())
})

describe('提交决策：增量 vs 整帧', () => {
  it('resize 触发空快照的原子提交：逻辑层清空换入、present 一次', async () => {
    const { logical, scratch, present } = harness()
    await flush()
    expect(scratch.clearRect).toHaveBeenCalledTimes(1)
    expect(logical.clearRect).toHaveBeenCalledTimes(1)
    expect(logical.drawImage).toHaveBeenCalledTimes(1)
    expect(present).toHaveBeenCalledTimes(1)
  })

  it('纯笔画快照走增量补画：不整帧清空、不经后备缓冲、无填充任务', async () => {
    const { machine, fill, logical, scratch, present } = harness()
    await flush()
    vi.mocked(logical.clearRect).mockClear()
    vi.mocked(scratch.clearRect).mockClear()
    present.mockClear()

    machine.sync(snapshotOf([strokeCommand()]))
    await flush()

    expect(fill.requests).toHaveLength(0)
    expect(scratch.clearRect).not.toHaveBeenCalled()
    expect(logical.clearRect).not.toHaveBeenCalled()
    expect(logical.stroke).toHaveBeenCalledTimes(1)
    expect(present).toHaveBeenCalledTimes(1)
  })

  it('含未着色填充的快照触发整帧：在途逻辑层保持上一完整帧，完成后原子换入', async () => {
    const { machine, fill, logical, scratch, present } = harness()
    await flush()
    vi.mocked(logical.clearRect).mockClear()
    vi.mocked(logical.drawImage).mockClear()
    vi.mocked(scratch.clearRect).mockClear()
    vi.mocked(scratch.stroke).mockClear()
    present.mockClear()

    machine.sync(snapshotOf([strokeCommand({ id: 'boundary' }), fillCommand({ id: 'first-fill' })]))
    await flush()

    expect(scratch.clearRect).toHaveBeenCalledTimes(1)
    expect(scratch.stroke).toHaveBeenCalledTimes(1)
    expect(fill.requests).toHaveLength(1)
    expect(fill.requests[0]!.input.roundId).toBe(ROUND)
    // 填充在途：逻辑层没有任何 clearRect/drawImage/present（09 采样的正是这个窗口）。
    expect(logical.clearRect).not.toHaveBeenCalled()
    expect(logical.drawImage).not.toHaveBeenCalled()
    expect(present).not.toHaveBeenCalled()

    fill.complete(1)
    await flush()
    expect(scratch.putImageData).toHaveBeenCalledTimes(1)
    expect(logical.clearRect).toHaveBeenCalledTimes(1)
    expect(logical.drawImage).toHaveBeenCalledTimes(1)
    expect(present).toHaveBeenCalledTimes(1)
  })

  it('填充在途时新快照取代重放：旧任务作废、逻辑层无空白窗口，新链完成后换入（09 回归）', async () => {
    const { machine, fill, logical, onFillFailure } = harness()
    await flush()
    const boundary = strokeCommand({ id: 'boundary' })
    const fillA = fillCommand({ id: 'fill-a' })
    machine.sync(snapshotOf([boundary, fillA]))
    await flush()
    expect(fill.requests).toHaveLength(1)

    // fill-a 未回，另一填充推送到达 → 世代取代并取消旧任务。
    machine.sync(snapshotOf([boundary, fillA, fillCommand({ id: 'fill-b', sequence: 3 })]))
    await flush()
    expect(onFillFailure).not.toHaveBeenCalled()
    expect(fill.cancel).toHaveBeenCalled()
    // 逻辑层仍只有 harness 的首帧空提交——被取代的重放从未触碰逻辑层。
    expect(logical.drawImage).toHaveBeenCalledTimes(1)

    // 新一代重放会重算全部填充：依次完成 fill-a、fill-b 后才允许换入。
    fill.complete(1)
    await flush()
    expect(logical.drawImage).toHaveBeenCalledTimes(1)
    fill.complete(1)
    await flush()
    expect(logical.drawImage).toHaveBeenCalledTimes(2)
  })

  it('取消不是故障；真实故障只报 onFillFailure；降级结果正常提交并记 worker_degraded', async () => {
    const { machine, fill, logical, onFillFailure, onRenderingChange } = harness()
    await flush()
    machine.sync(snapshotOf([fillCommand({ id: 'f1' })]))
    await flush()
    expect(onRenderingChange).toHaveBeenLastCalledWith(true)

    fill.reject(1, new FloodFillError('cancelled'))
    await flush()
    expect(onFillFailure).not.toHaveBeenCalled()
    expect(logical.drawImage).toHaveBeenCalledTimes(1)
    expect(onRenderingChange).toHaveBeenLastCalledWith(false)

    // 取消的世代没写过簿记：同快照再同步仍判定填充未着色 → 重新整帧。
    machine.sync(snapshotOf([fillCommand({ id: 'f1' })]))
    await flush()
    fill.reject(1, new Error('boom'))
    await flush()
    expect(onFillFailure).toHaveBeenCalledTimes(1)
    expect(logical.drawImage).toHaveBeenCalledTimes(1)

    machine.sync(snapshotOf([fillCommand({ id: 'f1' })]))
    await flush()
    fill.completeDegraded(1)
    await flush()
    expect(logical.drawImage).toHaveBeenCalledTimes(2)
    expect(getFillDiagnostics().map((item) => item.reason)).toEqual(['worker_degraded'])
  })

  it('filledPixels 为 0：不回写像素但整帧照常提交', async () => {
    const { machine, fill, logical, scratch } = harness()
    await flush()
    machine.sync(snapshotOf([fillCommand({ id: 'f1' })]))
    await flush()
    fill.complete(1, 0)
    await flush()
    expect(scratch.putImageData).not.toHaveBeenCalled()
    expect(logical.drawImage).toHaveBeenCalledTimes(2)
  })
})

describe('增量簿记与可见性', () => {
  it('已登记笔画的点列增长：只补画新增段，不整帧清空', async () => {
    const { machine, logical, scratch } = harness()
    await flush()
    const stroke = strokeCommand({ id: 's1' })
    machine.sync(snapshotOf([stroke]))
    await flush()
    vi.mocked(logical.clearRect).mockClear()
    const lineTos = vi.mocked(logical.lineTo).mock.calls.length

    const grown = strokeCommand({ id: 's1', points: [...stroke.points, { x: 0.9, y: 0.2 }] })
    machine.sync(snapshotOf([grown]))
    await flush()

    expect(logical.clearRect).not.toHaveBeenCalled()
    expect(scratch.clearRect).toHaveBeenCalledTimes(1) // 仅 harness 首帧
    expect(vi.mocked(logical.lineTo).mock.calls.length).toBe(lineTos + 1)
  })

  it('命令被权威移除触发整帧重放；空历史提交空帧', async () => {
    const { machine, logical } = harness()
    await flush()
    machine.sync(snapshotOf([strokeCommand({ id: 's1' })]))
    await flush()
    const before = vi.mocked(logical.drawImage).mock.calls.length

    machine.sync(snapshotOf([]))
    await flush()
    expect(logical.drawImage).toHaveBeenCalledTimes(before + 1)
  })

  it('undone 集合过滤可见性：被撤销命令不参与绘制，填充计数不变', async () => {
    const { machine, fill, scratch } = harness()
    await flush()
    const stroke = strokeCommand({ id: 's1' })
    const fillCmd = fillCommand({ id: 'f1' })
    machine.sync(snapshotOf([stroke, fillCmd]))
    await flush()
    fill.complete(1)
    await flush()
    vi.mocked(scratch.clearRect).mockClear()
    vi.mocked(scratch.stroke).mockClear()

    // 撤销填充命令：undo 长度变化触发整帧，重放里不再有填充。
    machine.sync(snapshotOf([stroke, fillCmd], ['f1']))
    await flush()
    expect(scratch.clearRect).toHaveBeenCalledTimes(1)
    expect(scratch.stroke).toHaveBeenCalledTimes(1) // 只剩 s1
    expect(fill.requests).toHaveLength(1)
  })

  it('回合切换触发整帧重放（新历史从零重绘）', async () => {
    const { machine, logical } = harness()
    await flush()
    machine.sync(snapshotOf([strokeCommand({ id: 's1' })]))
    await flush()
    const before = vi.mocked(logical.drawImage).mock.calls.length

    machine.sync(snapshotOf([strokeCommand({ id: 's2', sequence: 9 })], [], 'round-next'))
    await flush()
    expect(logical.drawImage).toHaveBeenCalledTimes(before + 1)
  })
})

describe('渲染态与预览端口', () => {
  it('渲染态随填充任务在途/结束报告忙碌与空闲', async () => {
    const { machine, fill, onRenderingChange } = harness()
    await flush()
    onRenderingChange.mockClear()
    machine.sync(snapshotOf([fillCommand({ id: 'f1' })]))
    await flush()
    expect(onRenderingChange).toHaveBeenCalledTimes(1)
    expect(onRenderingChange).toHaveBeenCalledWith(true)
    fill.complete(1)
    await flush()
    expect(onRenderingChange).toHaveBeenLastCalledWith(false)
  })

  it('预览：起笔与追点画在逻辑层；rebase 不绘制；endPreview 后追点无效', async () => {
    const { machine, logical } = harness()
    await flush()
    const strokes = vi.mocked(logical.stroke).mock.calls.length
    const lineTos = vi.mocked(logical.lineTo).mock.calls.length

    machine.beginPreview('p1', PREVIEW_STYLE, { x: 0.2, y: 0.2 })
    expect(vi.mocked(logical.lineTo).mock.calls.length).toBe(lineTos + 1) // 单点 +0.01 补偿段
    machine.addPreviewPoint({ x: 0.4, y: 0.4 })
    expect(vi.mocked(logical.lineTo).mock.calls.length).toBe(lineTos + 2)
    expect(vi.mocked(logical.stroke).mock.calls.length).toBe(strokes + 2)

    machine.rebasePreview('p2', PREVIEW_STYLE, { x: 0.4, y: 0.4 })
    expect(vi.mocked(logical.stroke).mock.calls.length).toBe(strokes + 2) // 不绘制

    machine.endPreview()
    machine.addPreviewPoint({ x: 0.6, y: 0.6 })
    expect(vi.mocked(logical.stroke).mock.calls.length).toBe(strokes + 2)
  })

  it('整帧提交把在途预览纳入本帧（后备缓冲一起换入，不吞当前笔）', async () => {
    const { machine, fill, logical, scratch } = harness()
    await flush()
    machine.sync(snapshotOf([fillCommand({ id: 'f1' })]))
    await flush()
    machine.beginPreview('p1', PREVIEW_STYLE, { x: 0.1, y: 0.1 })
    vi.mocked(logical.clearRect).mockClear()
    vi.mocked(logical.drawImage).mockClear()

    fill.complete(1)
    await flush()
    // 预览段绘制在后备缓冲上，随整帧一起原子换入——换入后画面即含当前笔。
    expect(scratch.stroke).toHaveBeenCalledTimes(1)
    expect(logical.clearRect).toHaveBeenCalledTimes(1)
    expect(logical.drawImage).toHaveBeenCalledTimes(1)
  })

  it('abandonPreview 抹簿记并整帧重放恢复权威画面', async () => {
    const { machine, logical } = harness()
    await flush()
    machine.sync(snapshotOf([strokeCommand({ id: 's1' })]))
    await flush()
    machine.beginPreview('ghost', PREVIEW_STYLE, { x: 0.3, y: 0.3 })
    const before = vi.mocked(logical.drawImage).mock.calls.length

    machine.abandonPreview('ghost')
    await flush()
    expect(logical.drawImage).toHaveBeenCalledTimes(before + 1)
  })

  it('replay 强制整帧（ack 合并规范化），逻辑层原子换入一次', async () => {
    const { machine, logical } = harness()
    await flush()
    machine.sync(snapshotOf([strokeCommand({ id: 's1' })]))
    await flush()
    const before = vi.mocked(logical.drawImage).mock.calls.length

    machine.replay()
    await flush()
    expect(logical.drawImage).toHaveBeenCalledTimes(before + 1)
  })

  it('dispose 后渲染态回调静默、在途任务被取消', async () => {
    const { machine, fill, logical, onRenderingChange } = harness()
    await flush()
    machine.sync(snapshotOf([fillCommand({ id: 'f1' })]))
    await flush()
    machine.dispose()
    // dispose 的取消动作以 cancelled 拒收在途任务：不得触发 onFillFailure/提交，
    // 渲染态回调在 dispose 后一律静默（组件已卸载，ref 无人为更新不报错）。
    onRenderingChange.mockClear()
    fill.cancel()
    await flush()
    expect(onRenderingChange).not.toHaveBeenCalled()
    expect(logical.drawImage).toHaveBeenCalledTimes(1) // 仍只有首帧空提交
  })
})

describe('定尺寸与历史容量', () => {
  it('长历史整帧重放：边界与每个点都绘制、填充任务恰好一次', async () => {
    const { machine, fill, scratch, logical } = harness()
    await flush()
    const history: DrawingCommand[] = [
      strokeCommand({ id: 'boundary', sequence: 0 }),
      fillCommand({ id: 'f1', sequence: 1 }),
    ]
    for (let index = 0; index < 300; index += 1) {
      history.push(
        strokeCommand({
          id: `dot-${index}`,
          sequence: index + 2,
          points: [{ x: 0.3, y: 0.3 }],
        }),
      )
    }
    machine.sync(snapshotOf(history))
    await flush()
    expect(fill.requests).toHaveLength(1)
    fill.complete(1)
    await flush()
    // 边界 1 次描边 + 300 个单点各 1 次补偿描边，全部发生在后备缓冲。
    expect(scratch.stroke).toHaveBeenCalledTimes(301)
    expect(logical.drawImage).toHaveBeenCalledTimes(2) // 空帧 + 全量提交
  })

  it('resize 同尺寸零开销；不同尺寸按新定标重放', async () => {
    const { machine, scratch } = harness()
    await flush()
    const clears = vi.mocked(scratch.clearRect).mock.calls.length
    machine.resize(LOGICAL_WIDTH, LOGICAL_HEIGHT)
    await flush()
    expect(vi.mocked(scratch.clearRect).mock.calls.length).toBe(clears)

    machine.resize(300, 150)
    await flush()
    expect(vi.mocked(scratch.clearRect).mock.calls.length).toBe(clears + 1)
    expect(scratch.clearRect).toHaveBeenLastCalledWith(0, 0, 300, 150)
  })

  it('speedrun 快速重播能在规定时间内推进并在完成时呈现画作', async () => {
    const { machine, present } = harness()
    const stroke = strokeCommand({
      id: 'stroke-speed',
      sequence: 1,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.5 },
      ],
    })
    machine.sync(snapshotOf([stroke]))
    await flush()

    const presentsBefore = vi.mocked(present).mock.calls.length
    await machine.speedrun(10)
    expect(vi.mocked(present).mock.calls.length).toBeGreaterThan(presentsBefore)
  })
})
