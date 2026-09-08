import { onBeforeUnmount, ref, type Ref } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import { APP_CONFIG } from '@draw-guess/config'
import type { DrawPoint, FillCommand, Stroke, StrokeAck, ToolKind } from '@draw-guess/shared'
import { createUuid } from '@/utils/createUuid'
import { renderStroke } from '@/canvas/rendering'
import type { RequestFailure, RequestResult } from '@/stores/request'

type StrokeStyle = { tool: 'pen' | 'eraser'; color: string; width: number }

export interface PendingStrokeBatch {
  strokeId: string
  startPointIndex: number
  sequence: number
  roundId: string
}

/** 单次按压笔画的采样、分批、序号与 ack 回滚会话。 */
export function useStrokeSession(options: {
  canvas: Ref<HTMLCanvasElement | undefined>
  width: Ref<number>
  canDraw: () => boolean
  tool: () => ToolKind
  color: () => string
  roundId: () => string
  lastSequence: () => number
  strokes: () => readonly { sequence: number }[]
  drawnPoints: Map<string, number>
  getContext: () => CanvasRenderingContext2D | null
  redraw: () => void
  emitStroke: (stroke: Stroke, onResult: (result: RequestResult<StrokeAck>) => void) => void
  onBatchFailure: (batch: PendingStrokeBatch, failure: RequestFailure) => void
  emitFill: (fill: FillCommand) => void
}) {
  const activePoints = ref<DrawPoint[]>([])
  const drawing = ref(false)
  let sequence = 0
  let activeStrokeId = ''
  let activeStyle: StrokeStyle | null = null
  let sentPointCount = 0
  const pendingBatches = new Map<number, PendingStrokeBatch>()

  function currentStrokeStyle(): StrokeStyle {
    return (
      activeStyle ?? {
        tool: options.tool() === 'eraser' ? 'eraser' : 'pen',
        color: options.color(),
        width: options.width.value,
      }
    )
  }

  function nextSequence(): number {
    sequence = Math.max(
      sequence + 1,
      options.lastSequence() + 1,
      ...options.strokes().map((command) => command.sequence + 1),
      0,
    )
    return sequence
  }

  function normalizedPoint(event: PointerEvent): DrawPoint {
    const rect = options.canvas.value?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }
  }

  const {
    isPending: batchPending,
    start: startBatchTimer,
    stop: stopBatchTimer,
  } = useTimeoutFn(flushPointBatch, APP_CONFIG.drawing.batchIntervalMs, { immediate: false })

  function flushPointBatch(): void {
    if (!activeStrokeId || sentPointCount >= activePoints.value.length) return
    const fromIndex = sentPointCount
    const unsent = activePoints.value.slice(fromIndex)
    for (let index = 0; index < unsent.length; index += APP_CONFIG.drawing.maxPointsPerBatch) {
      const points = unsent.slice(index, index + APP_CONFIG.drawing.maxPointsPerBatch)
      if (!points.length) continue
      const batchStroke: Stroke = {
        kind: 'stroke',
        id: activeStrokeId,
        ...currentStrokeStyle(),
        points,
        startPointIndex: fromIndex + index,
        sequence: nextSequence(),
      }
      const pending: PendingStrokeBatch = {
        strokeId: batchStroke.id,
        startPointIndex: batchStroke.startPointIndex ?? 0,
        sequence: batchStroke.sequence,
        roundId: options.roundId(),
      }
      pendingBatches.set(pending.sequence, pending)
      options.emitStroke(batchStroke, (result) => {
        const current = pendingBatches.get(pending.sequence)
        if (!current || current.strokeId !== pending.strokeId) return
        pendingBatches.delete(pending.sequence)
        if (result.ok || pending.roundId !== options.roundId()) return

        // 同一笔后续批次依赖连续点下标；其中一批失败后全部降级为权威快照，
        // 但只清理该 strokeId 的乐观痕迹，不能打断或误删后来开始的新笔画。
        for (const [sequenceKey, candidate] of pendingBatches) {
          if (candidate.strokeId === pending.strokeId) pendingBatches.delete(sequenceKey)
        }
        if (activeStrokeId === pending.strokeId) {
          drawing.value = false
          activePoints.value = []
          activeStrokeId = ''
          activeStyle = null
          sentPointCount = 0
          stopBatchTimer()
        }
        options.drawnPoints.delete(pending.strokeId)
        options.redraw()
        options.onBatchFailure(pending, result)
      })
    }
    sentPointCount = activePoints.value.length
  }

  function pointerDown(event: PointerEvent): void {
    if (!options.canDraw() || event.button !== 0) return
    const point = normalizedPoint(event)
    if (options.tool() === 'fill') {
      options.emitFill({
        kind: 'fill',
        id: createUuid(),
        point,
        color: options.color(),
        sequence: nextSequence(),
      })
      return
    }
    options.canvas.value?.setPointerCapture(event.pointerId)
    drawing.value = true
    activeStrokeId = createUuid()
    activeStyle = {
      tool: options.tool() === 'eraser' ? 'eraser' : 'pen',
      color: options.color(),
      width: options.width.value,
    }
    sentPointCount = 0
    activePoints.value = [point]
    options.drawnPoints.set(activeStrokeId, 1)
    const context = options.getContext()
    if (context)
      renderStroke(context, {
        kind: 'stroke',
        id: 'local-preview',
        ...currentStrokeStyle(),
        points: activePoints.value,
        sequence,
      })
    startBatchTimer()
  }

  function pointerMove(event: PointerEvent): void {
    if (!drawing.value || !options.canDraw()) return
    const point = normalizedPoint(event)
    const previous = activePoints.value.at(-1)
    if (
      previous &&
      Math.hypot(point.x - previous.x, point.y - previous.y) < APP_CONFIG.drawing.dedupDistance
    )
      return
    if (activePoints.value.length >= APP_CONFIG.drawing.maxPointsPerStroke) {
      flushPointBatch()
      const lastPoint = activePoints.value.at(-1) ?? point
      activeStrokeId = createUuid()
      sentPointCount = 0
      activePoints.value = [lastPoint]
      options.drawnPoints.set(activeStrokeId, 1)
    }
    const fromIndex = activePoints.value.length
    activePoints.value.push(point)
    options.drawnPoints.set(activeStrokeId, activePoints.value.length)
    const context = options.getContext()
    if (context)
      renderStroke(
        context,
        {
          kind: 'stroke',
          id: 'local-preview',
          ...currentStrokeStyle(),
          points: activePoints.value,
          sequence,
        },
        fromIndex,
      )
    if (!batchPending.value) startBatchTimer()
  }

  function pointerUp(event: PointerEvent): void {
    if (!drawing.value) return
    drawing.value = false
    flushPointBatch()
    activePoints.value = []
    activeStrokeId = ''
    activeStyle = null
    sentPointCount = 0
    if (options.canvas.value?.hasPointerCapture(event.pointerId))
      options.canvas.value.releasePointerCapture(event.pointerId)
  }

  function reset(): void {
    drawing.value = false
    activePoints.value = []
    activeStrokeId = ''
    activeStyle = null
    sentPointCount = 0
    pendingBatches.clear()
    stopBatchTimer()
  }

  function wheelWidth(event: WheelEvent): void {
    if (!options.canDraw() || options.tool() === 'fill') return
    event.preventDefault()
    const direction = event.deltaY < 0 ? 1 : -1
    options.width.value = Math.max(
      APP_CONFIG.drawing.width.min,
      Math.min(
        APP_CONFIG.drawing.width.max,
        options.width.value + direction * APP_CONFIG.drawing.width.wheelStep,
      ),
    )
  }

  onBeforeUnmount(() => {
    pendingBatches.clear()
    stopBatchTimer()
  })

  return {
    activePoints,
    drawing,
    pendingBatches,
    get activeStrokeId() {
      return activeStrokeId
    },
    currentStrokeStyle,
    pointerDown,
    pointerMove,
    pointerUp,
    wheelWidth,
    reset,
  }
}
