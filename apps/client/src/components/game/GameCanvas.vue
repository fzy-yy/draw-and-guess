<!--
  高 DPI 实时画板组合层。
  视口、光标和单次笔画会话由 composable 管理；本组件只负责权威历史重放与模板事件接线。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DrawingCommand, FillCommand, Stroke, StrokeAck, ToolKind } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { applyFloodFill, colorToRgba } from '@/canvas/flood-fill'
import { renderStroke } from '@/canvas/rendering'
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
const emit = defineEmits<{
  stroke: [stroke: Stroke, onResult: (result: RequestResult<StrokeAck>) => void]
  strokeFailure: [batch: PendingStrokeBatch, failure: RequestFailure]
  fill: [fill: FillCommand]
}>()

const canvas = ref<HTMLCanvasElement>()
const visibleCommands = computed(() =>
  props.strokes.filter((command) => !props.undoneStrokeIds.includes(command.id)),
)
const drawnPoints = new Map<string, number>()
let committedCount = 0
let committedUndoLen = props.undoneStrokeIds.length
let committedRoundId = props.roundId

function getContext(): CanvasRenderingContext2D | null {
  return canvas.value?.getContext('2d', { willReadFrequently: true }) ?? null
}

function drawFill(context: CanvasRenderingContext2D, command: FillCommand): void {
  const canvasWidth = context.canvas.width
  const canvasHeight = context.canvas.height
  if (!canvasWidth || !canvasHeight) return
  const startX = Math.max(
    0,
    Math.min(canvasWidth - 1, Math.round(command.point.x * (canvasWidth - 1))),
  )
  const startY = Math.max(
    0,
    Math.min(canvasHeight - 1, Math.round(command.point.y * (canvasHeight - 1))),
  )
  const image = context.getImageData(0, 0, canvasWidth, canvasHeight)
  const filled = applyFloodFill(
    image.data,
    canvasWidth,
    canvasHeight,
    startX,
    startY,
    colorToRgba(command.color),
  )
  if (filled > 0) context.putImageData(image, 0, 0)
}

function redraw(): void {
  const context = getContext()
  if (!context) return
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  for (const command of visibleCommands.value) {
    if (command.kind === 'stroke') renderStroke(context, command)
    else drawFill(context, command)
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
}

function drawIncoming(context: CanvasRenderingContext2D): void {
  for (const command of visibleCommands.value) {
    if (command.kind === 'fill') {
      if (drawnPoints.has(command.id)) continue
      drawFill(context, command)
      drawnPoints.set(command.id, -1)
      continue
    }
    const previousPointCount = drawnPoints.get(command.id) ?? 0
    if (command.points.length <= previousPointCount) continue
    renderStroke(context, command, previousPointCount)
    drawnPoints.set(command.id, command.points.length)
  }
  committedCount = visibleCommands.value.length
  committedRoundId = props.roundId
}

const strokeSession = useStrokeSession({
  canvas,
  width,
  canDraw: () => props.canDraw,
  tool: () => props.tool,
  color: () => props.color,
  roundId: () => props.roundId,
  lastSequence: () => props.lastSequence,
  strokes: () => props.strokes,
  drawnPoints,
  getContext,
  redraw,
  emitStroke: (stroke, onResult) => emit('stroke', stroke, onResult),
  onBatchFailure: (batch, failure) => emit('strokeFailure', batch, failure),
  emitFill: (fill) => emit('fill', fill),
})
const { resizeTick } = useCanvasViewport(canvas, redraw)
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
