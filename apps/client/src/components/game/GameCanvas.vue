<!--
  高 DPI 实时画板组合层。
  视口、光标和单次笔画会话由 composable 管理；本组件只负责权威历史重放与模板事件接线。
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
import { colorToRgba } from '@/canvas/flood-fill'
import { FloodFillWorkerClient } from '@/canvas/flood-fill-worker'
import { renderStroke } from '@/canvas/rendering'
import { presentLogicalCanvas } from '@/canvas/viewport'
import { useCanvasCursor } from '@/composables/useCanvasCursor'
import { useCanvasViewport } from '@/composables/useCanvasViewport'
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
const fillBusy = ref(false)
const fillWorker = new FloodFillWorkerClient()
/** ack 已确认但尚未在本地画布应用的填充修订；追平或超时后解除填充锁。 */
let pendingFillRevision: number | undefined
let fillReleaseTimer: number | undefined

function releaseFill(): void {
  pendingFillRevision = undefined
  window.clearTimeout(fillReleaseTimer)
  fillReleaseTimer = undefined
  fillBusy.value = false
}

/** 本地画布修订已追平 ack 修订时解锁；否则由 drawFill 完成或超时兜底调用。 */
function releaseFillIfCaughtUp(): void {
  if (pendingFillRevision === undefined) return
  if ((props.revision ?? 0) >= pendingFillRevision) releaseFill()
}

function handleFillResult(result: RequestResult<FillAck>): void {
  if (!result.ok) {
    releaseFill()
    return
  }
  pendingFillRevision = result.data.drawingRevision
  if ((props.revision ?? 0) >= pendingFillRevision) {
    releaseFill()
    return
  }
  // 推送可能被重同步兜底延迟：超时后强制解锁，避免填充键永久禁用。
  window.clearTimeout(fillReleaseTimer)
  fillReleaseTimer = window.setTimeout(releaseFill, APP_CONFIG.network.requestTimeoutMs)
}

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
  fillBusy.value = true
  try {
    const result = await fillWorker.fill(image, {
      roundId,
      startX,
      startY,
      replacement: colorToRgba(command.color),
      // 容差来自公开配置；Worker 只接收数值，不依赖配置包（见 flood-fill.ts 注释）。
      tolerance: APP_CONFIG.drawing.fillTolerance,
    })
    if (generation !== renderGeneration || roundId !== props.roundId) return false
    if (result.filledPixels > 0) context.putImageData(result.image, 0, 0)
    return true
  } catch {
    return false
  } finally {
    if (generation === renderGeneration) releaseFillIfCaughtUp()
  }
}

function redraw(): void {
  renderGeneration += 1
  fillWorker.cancel()
  releaseFill()
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
  canFill: () => !fillBusy.value,
  emitStroke: (stroke, onResult) => emit('stroke', stroke, onResult),
  onBatchFailure: (batch, failure) => emit('strokeFailure', batch, failure),
  emitFill: (fill) => {
    fillBusy.value = true
    pendingFillRevision = undefined
    window.clearTimeout(fillReleaseTimer)
    fillReleaseTimer = undefined
    emit('fill', fill, handleFillResult)
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
    if (roundChanged) strokeSession.reset()
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
  releaseFill()
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
