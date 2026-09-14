import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import type { DrawingCommand, FillCommand, Stroke, ToolKind } from '@draw-guess/shared'
import type { RequestResult } from '@/stores/request'
import GameCanvas from '@/components/game/GameCanvas.vue'

/**
 * GameCanvas 组合层的组件级保障：真实挂载组件（含视口/光标/笔迹三个 composable），
 * 统一替换 Canvas 2D 与布局 API，验证权威历史重放、增量投影与指针批次上送。
 * happy-dom 不实现 Canvas 2D，因此用轻量上下文替身记录绘制调用；Worker 缺失时组件自动走
 * 主线程降级路径，与浏览器不支持 Worker 的场景同构。
 */
const CONTEXT_WIDTH = 320
const CONTEXT_HEIGHT = 180
const ROUND_ID = '00000000-0000-4000-8000-000000000001'

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
    getImageData: vi.fn(() => new ImageData(CONTEXT_WIDTH, CONTEXT_HEIGHT)),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

function makeStroke(overrides: Partial<Stroke> = {}): Stroke {
  return {
    kind: 'stroke',
    id: '00000000-0000-4000-8000-0000000000a1',
    tool: 'pen',
    color: '#1F2937',
    width: 5,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.5 },
    ],
    sequence: 1,
    startPointIndex: 0,
    ...overrides,
  }
}

function makeFill(overrides: Partial<FillCommand> = {}): FillCommand {
  return {
    kind: 'fill',
    id: '00000000-0000-4000-8000-0000000000b1',
    point: { x: 0.5, y: 0.5 },
    color: '#EF4444',
    sequence: 1,
    ...overrides,
  }
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
  revision?: number
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

function displayContextOf(wrapper: VueWrapper): CanvasRenderingContext2D {
  const context = contexts.get(wrapper.find('canvas').element as HTMLCanvasElement)
  if (!context) throw new Error('展示画布尚未获取 2D 上下文')
  return context
}

beforeEach(() => {
  vi.useFakeTimers()
  contexts = new Map()
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
  vi.useRealTimers()
})

describe('GameCanvas 权威重放与增量投影', () => {
  it('挂载时重放权威笔画并把逻辑层投影到展示层', () => {
    const wrapper = mountCanvas({ strokes: [makeStroke()], lastSequence: 1 })
    const logical = logicalContextOf(wrapper)

    expect(logical.clearRect).toHaveBeenCalledTimes(1)
    expect(logical.stroke).toHaveBeenCalledTimes(1)
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
  it('填充命令在无 Worker 环境走主线程计算并写回逻辑层', async () => {
    const wrapper = mountCanvas({ strokes: [makeFill()], lastSequence: 1 })

    await vi.advanceTimersByTimeAsync(0)

    const logical = logicalContextOf(wrapper)
    expect(logical.getImageData).toHaveBeenCalledTimes(1)
    expect(logical.putImageData).toHaveBeenCalledTimes(1)
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

  it('填充 ack 业务失败时立即解锁', async () => {
    const wrapper = mountCanvas({ tool: 'fill', revision: 1 })
    await triggerFill(wrapper)

    completeOf(wrapper)(fillRejected())
    await triggerFill(wrapper)

    expect(wrapper.emitted('fill')).toHaveLength(2)
  })
})
