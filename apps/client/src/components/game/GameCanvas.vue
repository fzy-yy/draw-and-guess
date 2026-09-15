<!--
  高 DPI 实时画板组合层。
  视口、光标和单次笔画会话由 composable 管理；本组件只负责权威历史重放与模板事件接线。
  填充的两把锁（渲染态 / 本地提交待确认）由 useFillSession 持有，这里只负责驱动它们。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  EVENTS,
  type ClientResponse,
  type DrawingCommand,
  type FillCommand,
  type Stroke,
  type StrokeAck,
  type ToolKind,
} from '@draw-guess/shared'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { recordFillDiagnostic } from '@/canvas/fill-diagnostics'
import { colorToRgba } from '@/canvas/flood-fill'
import { FloodFillError, FloodFillWorkerClient } from '@/canvas/flood-fill-worker'
import { renderStroke } from '@/canvas/rendering'
import { presentLogicalCanvas } from '@/canvas/viewport'
import { useCanvasCursor } from '@/composables/useCanvasCursor'
import { useCanvasViewport } from '@/composables/useCanvasViewport'
import { useFillSession } from '@/composables/useFillSession'
import { useStrokeSession } from '@/composables/useStrokeSession'
import type { PendingStrokeBatch } from '@/composables/useStrokeSession'
import type { RequestFailure, RequestResult } from '@/stores/request'

const width = defineModel<number>('width', { required: true })
const props = defineProps<{
  roundId: string
  strokes: DrawingCommand[]
  undoneStrokeIds: string[]
  lastSequence: number
  canDraw: boolean
  tool: ToolKind
  color: string
  revision?: number
}>()
/** 填充 ack 携带服务端画布修订，用于判断本地是否已追平并安全解除填充锁。 */
type FillAck = ClientResponse<typeof EVENTS.drawFillCommit>

const emit = defineEmits<{
  stroke: [stroke: Stroke, onResult: (result: RequestResult<StrokeAck>) => void]
  strokeFailure: [batch: PendingStrokeBatch, failure: RequestFailure]
  fill: [fill: FillCommand, onResult: (result: RequestResult<FillAck>) => void]
  /** 重放所需的填充无法在本地完成：父层据此请求权威全量快照。 */
  fillFailure: []
}>()

const canvas = ref<HTMLCanvasElement>()
// 权威命令只在固定短边 720 的逻辑层重放；DOM canvas 仅承担按 DPR 输出。
const logicalCanvas = document.createElement('canvas')
const visibleCommands = computed(() =>
  props.strokes.filter((command) => !props.undoneStrokeIds.includes(command.id)),
)
const drawnPoints = new Map<string, number>()
let committedCount = 0
let committedUndoLen = props.undoneStrokeIds.length
let committedRoundId = props.roundId
let renderGeneration = 0
const fillWorker = new FloodFillWorkerClient()
const fillSession = useFillSession({
  revision: () => props.revision ?? 0,
  roundId: () => props.roundId,
})

function getContext(): CanvasRenderingContext2D | null {
  return logicalCanvas.getContext('2d', { willReadFrequently: true })
}

function present(): void {
  if (canvas.value) presentLogicalCanvas(logicalCanvas, canvas.value)
}

async function drawFill(
  context: CanvasRenderingContext2D,
  command: FillCommand,
  generation: number,
  roundId: string,
): Promise<boolean> {
  const canvasWidth = context.canvas.width
  const canvasHeight = context.canvas.height
  if (!canvasWidth || !canvasHeight) return false
  const startX = Math.max(
    0,
    Math.min(canvasWidth - 1, Math.round(command.point.x * (canvasWidth - 1))),
  )
  const startY = Math.max(
    0,
    Math.min(canvasHeight - 1, Math.round(command.point.y * (canvasHeight - 1))),
  )
  const image = context.getImageData(0, 0, canvasWidth, canvasHeight)
  fillSession.beginRenderTask()
  try {
    const result = await fillWorker.fill(image, {
      roundId,
      startX,
      startY,
      replacement: colorToRgba(command.color),
      // 容差来自公开配置；Worker 只接收数值，不依赖配置包（见 flood-fill.ts 注释）。
      tolerance: APP_CONFIG.drawing.fillTolerance,
    })
    // 世代或回合已变：结果属于过期历史，丢弃（新一轮重放会重算）。
    if (generation !== renderGeneration || roundId !== props.roundId) return false
    if (result.degraded) recordFillDiagnostic('worker_degraded')
    if (result.filledPixels > 0) context.putImageData(result.image, 0, 0)
    return true
  } catch (error) {
    // 取消/被新一轮重放取代不是故障：本次重放就此结束，由当前世代的重放负责画面。
    if (error instanceof FloodFillError && error.reason === 'cancelled') return false
    // 当前世代下这次填充无法在本地完成（Worker 与主线程降级都失败，或结果无法写回）：
    // 交回父层请求全量快照，并中止本次重放——避免在缺失填充的底色上继续叠加重放
    //（后续填充的种子会因此失真）。
    if (generation === renderGeneration && roundId === props.roundId) {
      recordFillDiagnostic('fill_unavailable')
      emit('fillFailure')
    }
    return false
  } finally {
    // 成功、失败、取消一律释放渲染态：渲染锁不得跨越任务生命周期。
    fillSession.endRenderTask()
  }
}

function redraw(): void {
  renderGeneration += 1
  fillWorker.cancel()
  void redrawLogical(renderGeneration, props.roundId)
}

async function redrawLogical(generation: number, roundId: string): Promise<void> {
  const context = getContext()
  if (!context) return
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  for (const command of visibleCommands.value) {
    if (command.kind === 'stroke') renderStroke(context, command)
    else if (!(await drawFill(context, command, generation, roundId))) return
    if (generation !== renderGeneration || roundId !== props.roundId) return
  }
  if (strokeSession.activePoints.value.length) {
    const confirmedStroke = visibleCommands.value.find(
      (command) => command.kind === 'stroke' && command.id === strokeSession.activeStrokeId,
    )
    const confirmedCount = confirmedStroke?.kind === 'stroke' ? confirmedStroke.points.length : 0
    renderStroke(
      context,
      {
        kind: 'stroke',
        id: 'local-preview',
        ...strokeSession.currentStrokeStyle(),
        points: strokeSession.activePoints.value,
        sequence: props.lastSequence,
      },
      confirmedCount,
    )
  }
  drawnPoints.clear()
  for (const command of visibleCommands.value)
    drawnPoints.set(command.id, command.kind === 'stroke' ? command.points.length : -1)
  committedCount = visibleCommands.value.length
  committedRoundId = props.roundId
  if (strokeSession.activeStrokeId && strokeSession.activePoints.value.length)
    drawnPoints.set(strokeSession.activeStrokeId, strokeSession.activePoints.value.length)
  committedUndoLen = props.undoneStrokeIds.length
  present()
}

function drawIncoming(context: CanvasRenderingContext2D): void {
  let changed = false
  for (const command of visibleCommands.value) {
    if (command.kind === 'fill') {
      if (drawnPoints.has(command.id)) continue
      redraw()
      return
    }
    const previousPointCount = drawnPoints.get(command.id) ?? 0
    if (command.points.length <= previousPointCount) continue
    renderStroke(context, command, previousPointCount)
    drawnPoints.set(command.id, command.points.length)
    changed = true
  }
  committedCount = visibleCommands.value.length
  committedRoundId = props.roundId
  // 无新增段时跳过整块展示层重投影（聊天/成员变化也会带来同版本新数组）。
  if (changed) present()
}

const strokeSession = useStrokeSession({
  canvas,
  width,
  canDraw: () => props.canDraw,
  tool: () => props.tool,
  color: () => props.color,
  roundId: () => props.roundId,
  lastSequence: () => props.lastSequence,
  drawnPoints,
  getContext,
  redraw,
  present,
  canFill: () => fillSession.canSubmit.value,
  emitStroke: (stroke, onResult) => emit('stroke', stroke, onResult),
  onBatchFailure: (batch, failure) => emit('strokeFailure', batch, failure),
  emitFill: (fill) => {
    // 提交锁绑定发起时的回合：旧回合的迟到 ack 由 settleSubmit 按回合丢弃。
    const roundId = props.roundId
    fillSession.beginSubmit()
    emit('fill', fill, (result) => fillSession.settleSubmit(result, roundId))
  },
})
const { resizeTick } = useCanvasViewport(canvas, logicalCanvas, redraw)
const cursor = useCanvasCursor({
  canvas,
  width,
  tool: () => props.tool,
  color: () => props.color,
  canDraw: () => props.canDraw,
  resizeTick,
})

watch(
  () => [
    props.roundId,
    props.strokes,
    props.strokes.length,
    props.revision ?? 0,
    props.undoneStrokeIds.length,
    props.undoneStrokeIds.at(-1),
  ],
  () => {
    const roundChanged = props.roundId !== committedRoundId
    if (roundChanged) {
      strokeSession.reset()
      // 旧回合的在途确认与超时兜底一律作废，避免新回合被旧回合的填充门禁卡住。
      fillSession.reset()
    }
    // 权威修订追平 ack 修订即解锁：与是否需要重放无关（重放由独立的渲染态负责）。
    fillSession.syncRevision()
    const visibleIds = new Set(visibleCommands.value.map((command) => command.id))
    const hasRemovedCommand = [...drawnPoints.keys()].some(
      (id) => id !== strokeSession.activeStrokeId && !visibleIds.has(id),
    )
    if (
      roundChanged ||
      hasRemovedCommand ||
      visibleCommands.value.some(
        (command) => command.kind === 'fill' && !drawnPoints.has(command.id),
      ) ||
      props.undoneStrokeIds.length !== committedUndoLen ||
      props.strokes.length < committedCount ||
      (props.strokes.length === 0 && drawnPoints.size > 0)
    ) {
      redraw()
      return
    }
    const context = getContext()
    if (context) drawIncoming(context)
  },
)

function handlePointerMove(event: PointerEvent): void {
  cursor.cursorTrack(event)
  strokeSession.pointerMove(event)
}

onBeforeUnmount(() => {
  fillSession.reset()
  fillWorker.dispose()
})
</script>

<template>
  <div
    class="relative h-full w-full"
    :class="{
      'cursor-none': cursor.showCursorDot.value,
      'cursor-copy': canDraw && tool === 'fill',
    }"
    @pointerenter="cursor.cursorEnter"
    @pointerleave="cursor.cursorLeave"
  >
    <canvas
      ref="canvas"
      data-canvas-layer="display"
      class="block h-full w-full bg-white touch-none"
      :aria-label="canDraw ? strings.canvas.drawingAria : strings.canvas.watchingAria"
      @pointerdown="strokeSession.pointerDown"
      @pointermove="handlePointerMove"
      @pointerup="strokeSession.pointerUp"
      @pointercancel="strokeSession.pointerUp"
      @wheel="strokeSession.wheelWidth"
    />
    <i
      v-if="cursor.showCursorDot.value"
      class="pointer-events-none absolute left-0 top-0 rounded-full border-[0.2cqh] border-navy/40"
      :style="{
        width: `${cursor.cursorDiameter.value}px`,
        height: `${cursor.cursorDiameter.value}px`,
        backgroundColor: cursor.cursorColor.value,
        transform: `translate(${cursor.cursorPos.value.x - cursor.cursorDiameter.value / 2}px, ${
          cursor.cursorPos.value.y - cursor.cursorDiameter.value / 2
        }px)`,
      }"
      aria-hidden="true"
    ></i>
  </div>
</template>
