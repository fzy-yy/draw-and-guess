import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import type { DrawingCommand, Stroke, ToolKind } from '@draw-guess/shared'
import { makeFill, makeStroke } from '../client/canvas-stubs'
import type { RequestResult } from '@/stores/request'
import { clearFillDiagnostics, getFillDiagnostics } from '@/canvas/fill-diagnostics'
import type { FloodFillWorkerRequest, FloodFillWorkerResponse } from '@/canvas/flood-fill-worker'
import GameCanvas from '@/components/game/GameCanvas.vue'

/**
 * GameCanvas 组合层的组件级保障：真实挂载组件（含视口/光标/笔迹三个 composable），
 * 统一替换 Canvas 2D 与布局 API，验证权威历史重放、增量投影与指针批次上送。
 * happy-dom 不实现 Canvas 2D，因此用轻量上下文替身记录绘制调用；默认环境没有 Worker，
 * 组件自动走主线程降级路径（与浏览器不支持 Worker 的场景同构），需要覆盖 Worker 成功/失败
 * 路径的用例显式 stubGlobal 一个可控 Worker 替身。
 */
const CONTEXT_WIDTH = 320
const CONTEXT_HEIGHT = 180
const ROUND_ID = '00000000-0000-4000-8000-000000000001'
const ROUND_ID_B = '00000000-0000-4000-8000-000000000002'

/**
 * 可控 Worker 替身：postMessage 只记录请求，由用例显式 complete/fail 决定结果，
 * 从而精确复现「Worker 成功」「Worker 运行失败」两条路径与常驻 Worker 的复用/终止语义。
 */
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<FloodFillWorkerResponse>) => void) | null = null
  onerror: (() => void) | null = null
  request?: FloodFillWorkerRequest
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(request: FloodFillWorkerRequest): void {
    this.request = request
  }

  terminate(): void {
    this.terminated = true
  }

  /** 回传独立缓冲的填充结果（模拟真实 Worker 的内存隔离），并记录用于断言写回内容。 */
  complete(): Uint8ClampedArray {
    const request = this.request
    if (!request) throw new Error('no flood-fill job posted')
    const filled = new Uint8ClampedArray(request.buffer.slice(0))
    filled.fill(0x11)
    this.onmessage?.({
      data: {
        type: 'filled',
        jobId: request.jobId,
        roundId: request.roundId,
        filledPixels: 64,
        peakWorkingBytes: 128,
        buffer: filled.buffer as ArrayBuffer,
      },
    } as MessageEvent<FloodFillWorkerResponse>)
    return filled
  }

  /** 模拟 Worker 运行失败（脚本加载失败或计算异常触发 onerror）。 */
  fail(): void {
    this.onerror?.()
  }
}

/** 逻辑层 getImageData 的默认返回：与展示层同尺寸的合法空白图像。 */
let imageDataFactory: (() => ImageData) | undefined

function createContextStub(): CanvasRenderingContext2D {
  return {
    canvas: { width: CONTEXT_WIDTH, height: CONTEXT_HEIGHT },
    globalCompositeOperation: 'source-over',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    imageSmoothingEnabled: true,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => imageDataFactory?.() ?? new ImageData(CONTEXT_WIDTH, CONTEXT_HEIGHT)),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

interface CanvasProps {
  width: number
  roundId: string
  strokes: DrawingCommand[]
  undoneStrokeIds: string[]
  lastSequence: number
  canDraw: boolean
  tool: ToolKind
  color: string
  // 组件侧 revision 为必填（协议必选整数），默认快照与构造参数同口径收严
  revision: number
}

function mountCanvas(props: Partial<CanvasProps> = {}) {
  return mount(GameCanvas, {
    props: {
      width: 5,
      roundId: ROUND_ID,
      strokes: [],
      undoneStrokeIds: [],
      lastSequence: -1,
      canDraw: true,
      tool: 'pen',
      color: '#1F2937',
      revision: 0,
      ...props,
    },
  })
}

let contexts: Map<HTMLCanvasElement, CanvasRenderingContext2D>

function contextFor(element: HTMLCanvasElement): CanvasRenderingContext2D {
  let context = contexts.get(element)
  if (!context) {
    context = createContextStub()
    contexts.set(element, context)
  }
  return context
}

/** 逻辑层是组件内创建的离屏 canvas，经组件暴露的 __logicalCanvas 探针取回其上下文。 */
function logicalContextOf(wrapper: VueWrapper): CanvasRenderingContext2D {
  const display = wrapper.find('canvas').element as HTMLCanvasElement & {
    __logicalCanvas?: HTMLCanvasElement
  }
  const logical = display.__logicalCanvas
  if (!logical) throw new Error('缺少逻辑画布测试探针')
  const context = contexts.get(logical)
  if (!context) throw new Error('逻辑画布尚未获取 2D 上下文')
  return context
}

/**
 * 重放后备缓冲（back buffer）：与逻辑层同样是组件内离屏创建的 canvas，
 * 用「既非展示层也非逻辑层」排除法取其上下文，验证「重放只画后备、成功才换入」。
 */
function scratchContextOf(wrapper: VueWrapper): CanvasRenderingContext2D {
  const display = wrapper.find('canvas').element as HTMLCanvasElement & {
    __logicalCanvas?: HTMLCanvasElement
  }
  for (const [element, context] of contexts) {
    if (element !== display && element !== display.__logicalCanvas) return context
  }
  throw new Error('重放后备缓冲尚未创建')
}

function displayContextOf(wrapper: VueWrapper): CanvasRenderingContext2D {
  const context = contexts.get(wrapper.find('canvas').element as HTMLCanvasElement)
  if (!context) throw new Error('展示画布尚未获取 2D 上下文')
  return context
}

/** 刷新微任务与 0ms 定时器：让 await 链（重放、ack 回调、锁释放）推进到稳定态。 */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

function useWorkerStub(): void {
  vi.stubGlobal('Worker', FakeWorker)
}

function latestWorkerRequest(): FloodFillWorkerRequest {
  const request = FakeWorker.instances.at(-1)?.request
  if (!request) throw new Error('组件未向 Worker 提交填充任务')
  return request
}

beforeEach(() => {
  vi.useFakeTimers()
  contexts = new Map()
  imageDataFactory = undefined
  FakeWorker.instances = []
  clearFillDiagnostics()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return contextFor(this) as never
  })
  // happy-dom 不执行布局：固定展示层为 640×360，使逻辑栅格推导确定（短边 360 → 1280×720）。
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 640,
    bottom: 360,
    width: 640,
    height: 360,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('GameCanvas 权威重放与增量投影', () => {
  it('挂载时重放权威笔画并原子提交、投影到展示层', () => {
    const wrapper = mountCanvas({ strokes: [makeStroke()], lastSequence: 1 })
    const logical = logicalContextOf(wrapper)
    const scratch = scratchContextOf(wrapper)

    // 重放绘制全部落在后备缓冲；逻辑层只看到一次原子换入（clearRect + drawImage）
    expect(scratch.clearRect).toHaveBeenCalledTimes(1)
    expect(scratch.stroke).toHaveBeenCalledTimes(1)
    expect(logical.clearRect).toHaveBeenCalledTimes(1)
    expect(logical.drawImage).toHaveBeenCalledTimes(1)
    // 提交后的换入与展示层投影是两次 drawImage：逻辑层一次、展示层一次
    expect(displayContextOf(wrapper).drawImage).toHaveBeenCalledTimes(1)
  })

  it('撤销列表变化会触发一次全量重放而不是增量补画', async () => {
    const stroke = makeStroke()
    const wrapper = mountCanvas({ strokes: [stroke], lastSequence: 1 })
    const logical = logicalContextOf(wrapper)
    const clearCallsAfterMount = vi.mocked(logical.clearRect).mock.calls.length

    await wrapper.setProps({ undoneStrokeIds: [stroke.id] })
    await nextTick()

    expect(vi.mocked(logical.clearRect).mock.calls.length).toBe(clearCallsAfterMount + 1)
  })

  it('指针批次上送单调序号，且始终紧接服务端 lastSequence', async () => {
    const wrapper = mountCanvas({
      lastSequence: 7,
      strokes: [makeStroke({ id: '00000000-0000-4000-8000-0000000000a2', sequence: 7 })],
    })
    const canvas = wrapper.find('canvas')

    await canvas.trigger('pointerdown', { button: 0, clientX: 32, clientY: 18, pointerId: 1 })
    await canvas.trigger('pointermove', { clientX: 96, clientY: 54, pointerId: 1 })
    await canvas.trigger('pointerup', { clientX: 96, clientY: 54, pointerId: 1 })

    const emitted = wrapper.emitted('stroke')
    expect(emitted).toHaveLength(1)
    const sent = emitted![0]![0] as Stroke
    expect(sent.sequence).toBe(8)
    expect(sent.startPointIndex).toBe(0)
    expect(sent.points).toHaveLength(2)
    // 绘制预览与批次上送都应经过同一逻辑层上下文
    expect(logicalContextOf(wrapper).lineTo).toHaveBeenCalled()
  })

  it('canDraw 为 false 时忽略指针输入且不产生批次', async () => {
    const wrapper = mountCanvas({ canDraw: false })
    const canvas = wrapper.find('canvas')

    await canvas.trigger('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    await canvas.trigger('pointerup', { clientX: 10, clientY: 10, pointerId: 1 })

    expect(wrapper.emitted('stroke')).toBeUndefined()
  })

  it('滚轮按配置步长调整共享粗细并向上抛出模型更新', async () => {
    const wrapper = mountCanvas()
    await wrapper.find('canvas').trigger('wheel', { deltaY: -100 })

    expect(wrapper.emitted('update:width')?.[0]).toEqual([6])
  })
})

describe('GameCanvas 填充降级路径', () => {
  it('填充命令在无 Worker 环境走主线程计算并经后备缓冲原子提交到逻辑层', async () => {
    const wrapper = mountCanvas({ strokes: [makeFill()], lastSequence: 1 })

    await flush()

    const scratch = scratchContextOf(wrapper)
    const logical = logicalContextOf(wrapper)
    expect(scratch.getImageData).toHaveBeenCalledTimes(1)
    expect(scratch.putImageData).toHaveBeenCalledTimes(1)
    // 逻辑层不承接任何中途绘制，只看到一次提交
    expect(logical.putImageData).not.toHaveBeenCalled()
    expect(logical.drawImage).toHaveBeenCalledTimes(1)
  })
})

describe('GameCanvas 填充重放（Worker 路径）', () => {
  async function triggerFill(wrapper: VueWrapper): Promise<void> {
    await wrapper
      .find('canvas')
      .trigger('pointerdown', { button: 0, clientX: 50, clientY: 50, pointerId: 1 })
  }

  it('初始历史含填充时交给 Worker 重放，任务期间占用渲染态、完成后提交并释放', async () => {
    useWorkerStub()
    const wrapper = mountCanvas({ strokes: [makeFill()], lastSequence: 1, tool: 'fill' })
    const logical = logicalContextOf(wrapper)
    const scratch = scratchContextOf(wrapper)

    expect(latestWorkerRequest()).toMatchObject({ roundId: ROUND_ID })
    // 填充在途：后备尚未着色，逻辑层更不该被触碰
    expect(scratch.putImageData).not.toHaveBeenCalled()
    expect(logical.drawImage).not.toHaveBeenCalled()

    // 渲染任务在途：填充指针请求被忽略，避免在未重放完的画布上继续提交。
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toBeUndefined()

    const filled = FakeWorker.instances[0]!.complete()
    await flush()

    // 着色写回后备缓冲，整帧成功后一次性原子换入逻辑层
    expect(scratch.putImageData).toHaveBeenCalledTimes(1)
    const written = vi.mocked(scratch.putImageData).mock.calls[0]![0] as ImageData
    expect(written.data.buffer).toBe(filled.buffer)
    expect(logical.drawImage).toHaveBeenCalledTimes(1)
    expect(FakeWorker.instances[0]!.terminated).toBe(false)
    expect(getFillDiagnostics()).toHaveLength(0)

    // 渲染态已在 finally 释放：同一封闭区域的填充可以继续提交。
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(1)
  })

  it('其他玩家的填充推送触发整块重放，重叠渲染任务不会提前释放渲染态', async () => {
    useWorkerStub()
    const fillA = makeFill({ id: '00000000-0000-4000-8000-0000000000c1' })
    const fillB = makeFill({ id: '00000000-0000-4000-8000-0000000000c2', sequence: 2 })
    const wrapper = mountCanvas({ strokes: [fillA], lastSequence: 1, tool: 'fill' })
    const logical = logicalContextOf(wrapper)
    const scratch = scratchContextOf(wrapper)
    expect(latestWorkerRequest()).toMatchObject({ roundId: ROUND_ID })

    // 第二个填充推送到达：新一轮重放取消旧任务，并在旧任务的 finally 之前启动新任务。
    await wrapper.setProps({
      strokes: [fillA, fillB],
      lastSequence: 2,
      revision: 2,
    })
    await flush()

    // 两代重放都只在后备缓冲上开工；旧任务被取消、新任务仍在途，逻辑层不得出现任何半成品帧
    expect(vi.mocked(scratch.clearRect).mock.calls.length).toBe(2)
    expect(vi.mocked(logical.clearRect).mock.calls.length).toBe(0)
    expect(vi.mocked(logical.drawImage).mock.calls.length).toBe(0)
    // 旧任务的 finally 不得把仍在途的新任务渲染态一并清除。
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toBeUndefined()

    FakeWorker.instances[0]!.complete()
    await flush()
    // A 着色完成但 B 仍在途：整帧未完成，依旧不得提交逻辑层
    expect(vi.mocked(scratch.putImageData).mock.calls.length).toBe(1)
    expect(vi.mocked(logical.drawImage).mock.calls.length).toBe(0)
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toBeUndefined()

    FakeWorker.instances[0]!.complete()
    await flush()
    // 整帧完成：着色两次 + 原子换入一次
    expect(vi.mocked(scratch.putImageData).mock.calls.length).toBe(2)
    expect(vi.mocked(logical.drawImage).mock.calls.length).toBe(1)
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(1)
  })

  it('重放途中逻辑层保持上一完整帧：填充在途不得留空白窗口（09 flake 回归）', async () => {
    useWorkerStub()
    const stroke = makeStroke()
    const fillA = makeFill({ id: '00000000-0000-4000-8000-0000000000c1', sequence: 2 })
    const fillB = makeFill({ id: '00000000-0000-4000-8000-0000000000c2', sequence: 3 })
    const wrapper = mountCanvas({ strokes: [stroke, fillA], lastSequence: 2, revision: 2 })
    // 首帧重放完成并提交：此后逻辑层应始终保留一份完整帧
    FakeWorker.instances[0]!.complete()
    await flush()
    const logical = logicalContextOf(wrapper)
    expect(vi.mocked(logical.drawImage).mock.calls.length).toBe(1)
    const clearsAtBaseline = vi.mocked(logical.clearRect).mock.calls.length
    const strokesAtBaseline = vi.mocked(logical.stroke).mock.calls.length

    // 新填充推送到达 → 触发整块重放；重放的绘制与填充计算都不得直接落在逻辑层上
    await wrapper.setProps({ strokes: [stroke, fillA, fillB], lastSequence: 3, revision: 3 })
    await flush()
    expect(vi.mocked(logical.clearRect).mock.calls.length).toBe(clearsAtBaseline)
    expect(vi.mocked(logical.stroke).mock.calls.length).toBe(strokesAtBaseline)

    // 新帧就绪：逐个完成在途填充（A、B 都要重放），整帧成功后逻辑层才出现 clearRect + drawImage
    for (let index = 0; index < 3; index += 1) {
      FakeWorker.instances.at(-1)!.complete()
      await flush()
    }
    expect(vi.mocked(logical.drawImage).mock.calls.length).toBe(2)
    expect(vi.mocked(logical.clearRect).mock.calls.length).toBe(clearsAtBaseline + 1)
  })

  it('重放被后续更新打断时逻辑层仍是上一完整帧，无空白中间态（09 flake 回归）', async () => {
    useWorkerStub()
    const stroke = makeStroke()
    const fillA = makeFill({ id: '00000000-0000-4000-8000-0000000000c1', sequence: 2 })
    const fillB = makeFill({ id: '00000000-0000-4000-8000-0000000000c2', sequence: 3 })
    const fillC = makeFill({ id: '00000000-0000-4000-8000-0000000000c3', sequence: 4 })
    const wrapper = mountCanvas({ strokes: [stroke, fillA], lastSequence: 2, revision: 2 })
    FakeWorker.instances[0]!.complete()
    await flush()
    const logical = logicalContextOf(wrapper)
    expect(vi.mocked(logical.drawImage).mock.calls.length).toBe(1)

    // B 帧重放途中被 C 的推送取代：B 作废不得提交；C 完成前逻辑层保持首帧
    await wrapper.setProps({ strokes: [stroke, fillA, fillB], lastSequence: 3, revision: 3 })
    await flush()
    await wrapper.setProps({ strokes: [stroke, fillA, fillB, fillC], lastSequence: 4, revision: 4 })
    await flush()
    expect(vi.mocked(logical.drawImage).mock.calls.length).toBe(1)
    expect(vi.mocked(logical.clearRect).mock.calls.length).toBe(1)

    // C 帧整帧成功后原子提交（A、B、C 三个填充依次重放完成）
    for (let index = 0; index < 4; index += 1) {
      FakeWorker.instances.at(-1)!.complete()
      await flush()
    }
    expect(vi.mocked(logical.drawImage).mock.calls.length).toBe(2)
  })

  it('Worker 运行失败时终止旧 Worker，并对同一 ImageData 只做一次主线程降级', async () => {
    useWorkerStub()
    const wrapper = mountCanvas({ strokes: [makeFill()], lastSequence: 1 })
    const scratch = scratchContextOf(wrapper)
    const worker = FakeWorker.instances[0]!
    expect(worker.request).toBeDefined()

    worker.fail()
    await flush()

    expect(worker.terminated).toBe(true)
    expect(scratch.getImageData).toHaveBeenCalledTimes(1)
    expect(scratch.putImageData).toHaveBeenCalledTimes(1)
    // 降级完成后同样整帧原子换入逻辑层
    expect(logicalContextOf(wrapper).drawImage).toHaveBeenCalledTimes(1)
    expect(getFillDiagnostics().map((item) => item.reason)).toEqual(['worker_degraded'])
    expect(wrapper.emitted('fillFailure')).toBeUndefined()
  })

  it('Worker 与主线程降级都失败时请求权威全量快照，并只记录脱敏诊断', async () => {
    useWorkerStub()
    // 缓冲区失效（例如被转移后作废）：主线程已无法基于同一 ImageData 完成降级。
    imageDataFactory = () => new ImageData(new Uint8ClampedArray(0), CONTEXT_WIDTH, CONTEXT_HEIGHT)
    const wrapper = mountCanvas({ strokes: [makeFill()], lastSequence: 1 })
    const scratch = scratchContextOf(wrapper)

    FakeWorker.instances[0]!.fail()
    await flush()

    expect(FakeWorker.instances[0]!.terminated).toBe(true)
    expect(scratch.putImageData).not.toHaveBeenCalled()
    // 重放中止于填充处：逻辑层不得接收任何换入提交（原子性保证无半成品帧）
    expect(logicalContextOf(wrapper).drawImage).not.toHaveBeenCalled()
    expect(wrapper.emitted('fillFailure')).toHaveLength(1)
    expect(getFillDiagnostics().map((item) => item.reason)).toEqual(['fill_unavailable'])
    // 诊断不含坐标、颜色、像素或答案等可复现画面内容。
    expect(Object.keys(getFillDiagnostics()[0]!).sort()).toEqual(['reason', 'receivedAt'])
  })
})

describe('GameCanvas 填充解锁', () => {
  type FillAck = { drawingRevision: number }
  type Complete = (result: RequestResult<FillAck>) => void

  function fillSuccess(drawingRevision: number): RequestResult<FillAck> {
    return { ok: true, data: { drawingRevision } }
  }

  function fillRejected(): RequestResult<FillAck> {
    return { ok: false, failureKind: 'business', error: '服务端拒绝', timeout: false }
  }

  async function triggerFill(wrapper: VueWrapper): Promise<void> {
    await wrapper
      .find('canvas')
      .trigger('pointerdown', { button: 0, clientX: 50, clientY: 50, pointerId: 1 })
  }

  function completeOf(wrapper: VueWrapper, index = 0): Complete {
    return wrapper.emitted('fill')![index]![1] as Complete
  }

  it('ack 修订已追平时立即解锁，后续填充可继续提交', async () => {
    const wrapper = mountCanvas({ tool: 'fill', revision: 1 })
    await triggerFill(wrapper)

    completeOf(wrapper)(fillSuccess(1))
    await triggerFill(wrapper)

    expect(wrapper.emitted('fill')).toHaveLength(2)
  })

  it('本地填充待确认期间忽略重复填充，直到可信更新到达', async () => {
    const wrapper = mountCanvas({ tool: 'fill', revision: 1 })
    await triggerFill(wrapper)

    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(1)

    completeOf(wrapper)(fillSuccess(4))
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(1)
  })

  it('推送延迟时保持锁定，超时兜底后解锁', async () => {
    const wrapper = mountCanvas({ tool: 'fill', revision: 1 })
    await triggerFill(wrapper)
    completeOf(wrapper)(fillSuccess(5))

    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(APP_CONFIG.network.requestTimeoutMs)
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(2)
  })

  it('超时兜底解锁后，迟到的推送不会重新上锁', async () => {
    const wrapper = mountCanvas({ tool: 'fill', revision: 1 })
    await triggerFill(wrapper)
    completeOf(wrapper)(fillSuccess(5))
    await vi.advanceTimersByTimeAsync(APP_CONFIG.network.requestTimeoutMs)

    await wrapper.setProps({ revision: 5, strokes: [makeFill()], lastSequence: 1 })
    await flush()
    await triggerFill(wrapper)

    expect(wrapper.emitted('fill')).toHaveLength(2)
  })

  it('ack 已到但推送延迟时，权威修订追平即解锁而不必等到超时', async () => {
    const wrapper = mountCanvas({ tool: 'fill', revision: 1 })
    await triggerFill(wrapper)
    completeOf(wrapper)(fillSuccess(6))

    await wrapper.setProps({ revision: 5 })
    await flush()
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(1)

    await wrapper.setProps({ revision: 6, strokes: [makeFill()], lastSequence: 1 })
    await flush()
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(2)
  })

  it('其他玩家的填充推送（本地提交仍在途）不会释放本地提交锁', async () => {
    const wrapper = mountCanvas({ tool: 'fill', revision: 1 })
    await triggerFill(wrapper)
    completeOf(wrapper)(fillSuccess(5))

    // 他人填充触发整块重放，但本地提交锁只能由「自己的」修订追平或超时释放。
    await wrapper.setProps({
      strokes: [makeFill({ id: '00000000-0000-4000-8000-0000000000d1' })],
      lastSequence: 2,
      revision: 2,
    })
    await flush()
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(1)

    await wrapper.setProps({
      strokes: [makeFill({ id: '00000000-0000-4000-8000-0000000000d2' })],
      lastSequence: 3,
      revision: 5,
    })
    await flush()
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(2)
  })

  it('填充 ack 业务失败时立即解锁', async () => {
    const wrapper = mountCanvas({ tool: 'fill', revision: 1 })
    await triggerFill(wrapper)

    completeOf(wrapper)(fillRejected())
    await triggerFill(wrapper)

    expect(wrapper.emitted('fill')).toHaveLength(2)
  })

  it('回合切换作废旧回合的在途提交，新回合可立即填充', async () => {
    const wrapper = mountCanvas({ tool: 'fill', revision: 1 })
    await triggerFill(wrapper)

    await wrapper.setProps({ roundId: ROUND_ID_B, strokes: [], lastSequence: -1, revision: 0 })
    await flush()

    // 旧回合的 ack 迟到：不得把新回合的填充门禁锁死。
    completeOf(wrapper)(fillSuccess(9))
    await flush()
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(2)
  })

  it('回合切换后旧回合的迟到 ack 不会提前解锁新回合的在途提交', async () => {
    const wrapper = mountCanvas({ tool: 'fill', revision: 1 })
    await triggerFill(wrapper)
    await wrapper.setProps({ roundId: ROUND_ID_B, strokes: [], lastSequence: -1, revision: 1 })
    await flush()

    // 新回合的填充：ack 修订 5 尚未追平，提交锁必须保持。
    await triggerFill(wrapper)
    completeOf(wrapper, 1)(fillSuccess(5))
    await flush()

    // 旧回合的 ack 修订（1）恰好是本地已追平的修订：不得据此释放新回合的提交锁。
    completeOf(wrapper)(fillSuccess(1))
    await flush()
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(2)

    await wrapper.setProps({ revision: 5, strokes: [makeFill()], lastSequence: 2 })
    await flush()
    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(3)
  })

  it('回合切换取消在途渲染任务并释放渲染态', async () => {
    useWorkerStub()
    const wrapper = mountCanvas({ strokes: [makeFill()], lastSequence: 1, tool: 'fill' })
    expect(latestWorkerRequest()).toMatchObject({ roundId: ROUND_ID })

    await wrapper.setProps({ roundId: ROUND_ID_B, strokes: [], lastSequence: -1, revision: 0 })
    await flush()

    await triggerFill(wrapper)
    expect(wrapper.emitted('fill')).toHaveLength(1)
  })
})
