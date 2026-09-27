import { onBeforeUnmount, ref, type Ref } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import { APP_CONFIG } from '@draw-guess/config'
import type { DrawPoint, FillCommand, Stroke, StrokeAck, ToolKind } from '@draw-guess/shared'
import { createUuid } from '@/utils/create-uuid'
import type { RequestFailure, RequestResult } from '@/stores/request'

type StrokeStyle = { tool: 'pen' | 'eraser'; color: string; width: number }

/**
 * 笔画会话所需的画布渲染端口（DrawingReplayMachine 结构上满足；测试注入可编程替身）。
 * 会话只描述「笔尖发生了什么」，不持有画布上下文与簿记——预览像素、世代取代、
 * 失败回滚重放全部由端口实现方裁决（ADR-0018）。
 */
export interface StrokePreviewSurface {
  /** 起笔：登记预览并绘制首个圆点。 */
  beginPreview(id: string, style: StrokeStyle, point: DrawPoint): void
  /** 移动：绘制新增段并同步预览簿记。 */
  addPreviewPoint(point: DrawPoint): void
  /** 超长切笔：新 id 承接已绘制的终点，只换绑簿记、不绘制。 */
  rebasePreview(id: string, style: StrokeStyle, carriedPoint: DrawPoint): void
  /** 收笔/会话作废：停止预览跟踪（像素留在画布上直至下一次提交）。 */
  endPreview(): void
  /** 批次失败：抹掉该乐观笔画的簿记并整帧重放恢复权威画面。 */
  abandonPreview(id: string): void
  /** 强制整帧重放（ack 全部确认后的合并点列规范化）。 */
  replay(): void
}

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
  canFill?: () => boolean
  tool: () => ToolKind
  color: () => string
  roundId: () => string
  lastSequence: () => number
  preview: StrokePreviewSurface
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
    // 本地单调计数 + 服务端已接受的最大序号。历史命令的 sequence 必然 ≤ lastSequence，
    // 因此无需每批扫描全部历史（O(n)），本地乐观批次由本计数器覆盖。
    sequence = Math.max(sequence + 1, options.lastSequence() + 1, 0)
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
        if (result.ok) {
          // 一笔全部确认且指针已释放后，以服务端合并后的完整点列重放一次，消除不同批次
          // stroke() 抗锯齿顺序造成的客户端逻辑像素差异。
          if (!activeStrokeId && pendingBatches.size === 0) options.preview.replay()
          return
        }
        if (pending.roundId !== options.roundId()) return

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
        // 簿记抹除 + 整帧重放恢复权威画面由机器裁决（preview 端口，ADR-0018）。
        options.preview.abandonPreview(pending.strokeId)
        options.onBatchFailure(pending, result)
      })
    }
    sentPointCount = activePoints.value.length
  }

  function pointerDown(event: PointerEvent): void {
    if (!options.canDraw() || event.button !== 0) return
    const point = normalizedPoint(event)
    if (options.tool() === 'fill') {
      if (options.canFill && !options.canFill()) return
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
    // 预览首点（含单点圆点补偿）、簿记与投影由机器端口完成（ADR-0018）。
    options.preview.beginPreview(activeStrokeId, currentStrokeStyle(), point)
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
      // 切笔首点是上一段已绘终点：只换绑簿记、不绘制（与旧行为逐位一致）。
      options.preview.rebasePreview(activeStrokeId, currentStrokeStyle(), lastPoint)
    }
    activePoints.value.push(point)
    options.preview.addPreviewPoint(point)
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
    // 预览跟踪结束；若无在途批次，立即以权威历史整帧重放规范化（旧行为不变）。
    options.preview.endPreview()
    if (pendingBatches.size === 0) options.preview.replay()
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
    options.preview.endPreview()
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
    pendingBatches,
    get activeStrokeId() {
      return activeStrokeId
    },
    pointerDown,
    pointerMove,
    pointerUp,
    wheelWidth,
    reset,
  }
}
