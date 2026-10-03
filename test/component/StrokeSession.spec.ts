import { defineComponent, h, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ERROR_CODES,
  type ErrorCode,
  type Stroke,
  type StrokeAck,
  type ToolKind,
} from '@draw-guess/shared'
import { useStrokeSession } from '@/composables/useStrokeSession'
import type { RequestFailure, RequestResult } from '@/stores/request'

interface SentBatch {
  stroke: Stroke
  complete(result: RequestResult<StrokeAck>): void
}

function pointer(clientX: number, clientY: number, pointerId = 1): PointerEvent {
  return { button: 0, clientX, clientY, pointerId } as PointerEvent
}

function businessFailure(code: ErrorCode = ERROR_CODES.INVALID_DRAW_STYLE): RequestFailure {
  return { ok: false, failureKind: 'business', error: '服务端拒绝笔画', code, timeout: false }
}

function transportFailure(): RequestFailure {
  return { ok: false, failureKind: 'transport', error: '网络超时', timeout: true }
}

function accepted(stroke: Stroke): RequestResult<StrokeAck> {
  return {
    ok: true,
    data: {
      strokeId: stroke.id,
      pointCount: (stroke.startPointIndex ?? 0) + stroke.points.length,
      drawingRevision: stroke.sequence,
      remainingBudget: 100,
    },
  }
}

function createSessionHarness(options: { tool?: ToolKind; canFill?: () => boolean } = {}) {
  const sent: SentBatch[] = []
  const authoritativeStrokes: Stroke[] = []
  const onBatchFailure = vi.fn()
  const emitFill = vi.fn()
  // 会话只描述笔画事件；预览绘制/簿记/回滚重放由端口承担（这里用可编程替身观察调用）。
  const preview = {
    beginPreview: vi.fn(),
    addPreviewPoint: vi.fn(),
    rebasePreview: vi.fn(),
    endPreview: vi.fn(),
    abandonPreview: vi.fn(),
    replay: vi.fn(),
  }
  let roundId = 'round-a'
  let session!: ReturnType<typeof useStrokeSession>
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => false),
    releasePointerCapture: vi.fn(),
  } as unknown as HTMLCanvasElement

  const Harness = defineComponent({
    setup() {
      session = useStrokeSession({
        canvas: ref(canvas),
        width: ref(5),
        canDraw: () => true,
        tool: () => options.tool ?? 'pen',
        canFill: options.canFill,
        color: () => '#1F2937',
        roundId: () => roundId,
        lastSequence: () => -1,
        preview,
        emitStroke: (stroke, complete) => sent.push({ stroke, complete }),
        onBatchFailure,
        emitFill,
      })
      return () => h('div')
    },
  })
  const wrapper = mount(Harness)

  function drawAndRelease(pointCount: number): void {
    session.pointerDown(pointer(0, 0))
    for (let index = 1; index < pointCount; index += 1)
      session.pointerMove(pointer(index % 100, Math.floor(index / 100) * 10))
    session.pointerUp(pointer(0, 0))
  }

  return {
    sent,
    session,
    authoritativeStrokes,
    preview,
    onBatchFailure,
    emitFill,
    wrapper,
    drawAndRelease,
    changeRound: (next: string) => (roundId = next),
  }
}

const mountedWrappers: VueWrapper[] = []

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.useRealTimers()
})

function trackedHarness(): ReturnType<typeof createSessionHarness> {
  const harness = createSessionHarness()
  mountedWrappers.push(harness.wrapper)
  return harness
}

describe('绘图乐观批次失败回滚', () => {
  it('按下发送并松手后到达的传输失败仍会清除乐观预览', () => {
    const harness = trackedHarness()
    harness.drawAndRelease(2)
    expect(harness.session.activeStrokeId).toBe('')
    expect(harness.session.pendingBatches.size).toBe(1)

    harness.sent[0]!.complete(transportFailure())

    expect(harness.session.pendingBatches.size).toBe(0)
    // 失败回滚经端口完成：机器抹簿记并整帧重放（abandonPreview 内含 replay）。
    expect(harness.preview.abandonPreview).toHaveBeenCalledOnce()
    expect(harness.onBatchFailure).toHaveBeenCalledOnce()
  })

  it('同一笔多批次的中间失败不会删除已经确认的后续权威笔画', () => {
    const harness = trackedHarness()
    harness.drawAndRelease(241)
    expect(harness.sent.map(({ stroke }) => stroke.startPointIndex)).toEqual([0, 120, 240])
    const confirmed = {
      ...harness.sent[2]!.stroke,
      points: harness.sent.flatMap(({ stroke }) => stroke.points),
    }
    harness.authoritativeStrokes.push(confirmed)
    harness.sent[0]!.complete(accepted(harness.sent[0]!.stroke))
    harness.sent[2]!.complete(accepted(harness.sent[2]!.stroke))

    harness.sent[1]!.complete(businessFailure())

    expect(harness.authoritativeStrokes).toEqual([confirmed])
    expect(harness.session.pendingBatches.size).toBe(0)
    expect(harness.preview.abandonPreview).toHaveBeenCalledOnce()
    expect(harness.onBatchFailure).toHaveBeenCalledOnce()
  })

  it('绘图预算超限会携带业务拒绝原因触发一次权威恢复', () => {
    const harness = trackedHarness()
    harness.drawAndRelease(2)
    const failure = businessFailure('DRAW_BUDGET_EXCEEDED')

    harness.sent[0]!.complete(failure)

    expect(harness.onBatchFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        strokeId: harness.sent[0]!.stroke.id,
        startPointIndex: 0,
        sequence: harness.sent[0]!.stroke.sequence,
      }),
      failure,
    )
    expect(harness.onBatchFailure).toHaveBeenCalledOnce()
  })

  it('旧回合的失败回调只回收旧 pending，不重绘或重同步当前回合', () => {
    const harness = trackedHarness()
    harness.drawAndRelease(2)
    harness.changeRound('round-b')

    harness.sent[0]!.complete(transportFailure())

    expect(harness.session.pendingBatches.size).toBe(0)
    expect(harness.preview.abandonPreview).not.toHaveBeenCalled()
    expect(harness.preview.replay).not.toHaveBeenCalled()
    expect(harness.onBatchFailure).not.toHaveBeenCalled()
  })
})

describe('异步洪泛填充输入门禁', () => {
  it('Worker 计算中忽略重复 fill 指针请求', () => {
    const harness = createSessionHarness({ tool: 'fill', canFill: () => false })
    mountedWrappers.push(harness.wrapper)

    harness.session.pointerDown(pointer(50, 50))
    harness.session.pointerDown(pointer(60, 60))

    expect(harness.emitFill).not.toHaveBeenCalled()
  })
})
