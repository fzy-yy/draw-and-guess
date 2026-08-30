<!--
  高 DPI 实时画板。
  自由笔画按批次发送；区域填充只提交归一化点击位置和颜色，由每个客户端按同一历史确定像素区域。
  坐标始终归一化为 0～1，因此窗口缩放和断线重建不会使绘图位置漂移。
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  type DrawingCommand,
  type DrawPoint,
  type FillCommand,
  type Stroke,
  type ToolKind,
} from '@draw-guess/shared'
import { APP_CONFIG } from '@draw-guess/config'
import { createUuid } from '@/utils/createUuid'

const props = defineProps<{
  strokes: DrawingCommand[]
  undoneStrokeIds: string[]
  canDraw: boolean
  tool: ToolKind
  color: string
  width: number
}>()
const emit = defineEmits<{
  stroke: [stroke: Stroke]
  fill: [fill: FillCommand]
  widthChange: [width: number]
}>()

const canvas = ref<HTMLCanvasElement>()
const activePoints = ref<DrawPoint[]>([])
const drawing = ref(false)
let observer: ResizeObserver | undefined
let sequence = 0
let activeStrokeId = ''
let sentPointCount = 0
let batchTimer = 0

const visibleCommands = computed(() =>
  props.strokes.filter((command) => !props.undoneStrokeIds.includes(command.id)),
)

/** 按 CSS 尺寸与设备像素比重建像素缓冲，再完整重绘权威历史。 */
function resizeCanvas(): void {
  const element = canvas.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const ratio = Math.min(window.devicePixelRatio || 1, 2.5)
  element.width = Math.max(1, Math.round(rect.width * ratio))
  element.height = Math.max(1, Math.round(rect.height * ratio))
  redraw()
}

/** 绘制自由笔画；橡皮擦使用 destination-out 做透明擦除，并与画笔共用 width。 */
function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke): void {
  if (!stroke.points.length) return
  const canvasWidth = context.canvas.width
  const canvasHeight = context.canvas.height
  const scale = Math.min(canvasWidth, canvasHeight) / 720
  context.save()
  context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
  context.strokeStyle = stroke.color
  context.lineWidth = stroke.width * Math.max(0.6, scale)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  const first = stroke.points[0]
  if (!first) {
    context.restore()
    return
  }
  context.moveTo(first.x * canvasWidth, first.y * canvasHeight)
  for (const point of stroke.points.slice(1))
    context.lineTo(point.x * canvasWidth, point.y * canvasHeight)
  if (stroke.points.length === 1)
    context.lineTo(first.x * canvasWidth + 0.01, first.y * canvasHeight + 0.01)
  context.stroke()
  context.restore()
}

/** 把配置允许的六位 HEX 颜色转换为 Canvas ImageData 使用的 RGBA。 */
function colorToRgba(color: string): readonly [number, number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
    255,
  ]
}

/** 判断像素是否仍属于起始区域；容差只与最初目标色比较，避免逐级跨过抗锯齿边界。 */
function pixelMatches(
  data: Uint8ClampedArray,
  offset: number,
  target: readonly [number, number, number, number],
): boolean {
  const tolerance = APP_CONFIG.drawing.fillTolerance
  return (
    Math.abs((data[offset] ?? 0) - target[0]) <= tolerance &&
    Math.abs((data[offset + 1] ?? 0) - target[1]) <= tolerance &&
    Math.abs((data[offset + 2] ?? 0) - target[2]) <= tolerance &&
    Math.abs((data[offset + 3] ?? 0) - target[3]) <= tolerance
  )
}

/** 将一个像素写为不透明目标色；写入本身也作为 visited 标记，避免额外内存。 */
function setPixel(
  data: Uint8ClampedArray,
  offset: number,
  replacement: readonly [number, number, number, number],
): void {
  data[offset] = replacement[0]
  data[offset + 1] = replacement[1]
  data[offset + 2] = replacement[2]
  data[offset + 3] = replacement[3]
}

/**
 * 使用四方向洪泛算法填充与点击像素连通的区域。
 * 队列使用定长 Int32Array，避免大画布上 JavaScript 对象队列产生大量临时内存。
 */
function drawFill(context: CanvasRenderingContext2D, command: FillCommand): void {
  const width = context.canvas.width
  const height = context.canvas.height
  if (!width || !height) return
  const startX = Math.max(0, Math.min(width - 1, Math.round(command.point.x * (width - 1))))
  const startY = Math.max(0, Math.min(height - 1, Math.round(command.point.y * (height - 1))))
  const image = context.getImageData(0, 0, width, height)
  const data = image.data
  const startIndex = startY * width + startX
  const startOffset = startIndex * 4
  const target = [
    data[startOffset] ?? 0,
    data[startOffset + 1] ?? 0,
    data[startOffset + 2] ?? 0,
    data[startOffset + 3] ?? 0,
  ] as const
  const replacement = colorToRgba(command.color)
  if (
    target.every(
      (channel, index) =>
        Math.abs(channel - (replacement[index] ?? channel)) <= APP_CONFIG.drawing.fillTolerance,
    )
  )
    return

  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0
  queue[tail] = startIndex
  tail += 1
  setPixel(data, startOffset, replacement)

  /** 匹配成功的相邻像素在入队前立即着色，因此每个像素最多入队一次。 */
  const enqueueIfTarget = (pixelIndex: number): void => {
    const offset = pixelIndex * 4
    if (!pixelMatches(data, offset, target)) return
    setPixel(data, offset, replacement)
    queue[tail] = pixelIndex
    tail += 1
  }

  while (head < tail) {
    const pixelIndex = queue[head] ?? 0
    head += 1
    const x = pixelIndex % width
    const y = Math.floor(pixelIndex / width)
    if (x > 0) enqueueIfTarget(pixelIndex - 1)
    if (x + 1 < width) enqueueIfTarget(pixelIndex + 1)
    if (y > 0) enqueueIfTarget(pixelIndex - width)
    if (y + 1 < height) enqueueIfTarget(pixelIndex + width)
  }
  context.putImageData(image, 0, 0)
}

/** 清空并依序重绘权威历史，再叠加尚未提交完毕的本地自由笔画。 */
function redraw(): void {
  const context = canvas.value?.getContext('2d', { willReadFrequently: true })
  if (!context) return
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  for (const command of visibleCommands.value) {
    if (command.kind === 'stroke') drawStroke(context, command)
    else drawFill(context, command)
  }
  if (activePoints.value.length) {
    drawStroke(context, {
      kind: 'stroke',
      id: 'local-preview',
      tool: props.tool === 'eraser' ? 'eraser' : 'pen',
      color: props.color,
      width: props.width,
      points: activePoints.value,
      sequence,
    })
  }
}

/** 将指针事件坐标裁剪并归一化到 0～1。 */
function normalizedPoint(event: PointerEvent): DrawPoint {
  const rect = canvas.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  }
}

/** 返回严格递增且高于当前权威历史的序号，避免本地重连后提交旧命令。 */
function nextSequence(): number {
  sequence = Math.max(sequence + 1, ...props.strokes.map((command) => command.sequence + 1), 0)
  return sequence
}

/** 指针按下时立即提交填充，或开始记录画笔/橡皮擦的自由笔画。 */
function pointerDown(event: PointerEvent): void {
  if (!props.canDraw || event.button !== 0) return
  const point = normalizedPoint(event)
  if (props.tool === 'fill') {
    emit('fill', {
      kind: 'fill',
      id: createUuid(),
      point,
      color: props.color,
      sequence: nextSequence(),
    })
    return
  }
  canvas.value?.setPointerCapture(event.pointerId)
  drawing.value = true
  activeStrokeId = createUuid()
  sentPointCount = 0
  activePoints.value = [point]
  batchTimer = window.setTimeout(flushPointBatch, APP_CONFIG.drawing.batchIntervalMs)
  redraw()
}

/** 指针移动时为自由笔画追加经过距离去抖的采样点。 */
function pointerMove(event: PointerEvent): void {
  if (!drawing.value || !props.canDraw) return
  const point = normalizedPoint(event)
  const previous = activePoints.value.at(-1)
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0015) return
  activePoints.value.push(point)
  if (!batchTimer)
    batchTimer = window.setTimeout(flushPointBatch, APP_CONFIG.drawing.batchIntervalMs)
  redraw()
}

/** 每个配置批处理周期仅发送自由笔画新增点，既保证实时性也限制网络事件量。 */
function flushPointBatch(): void {
  window.clearTimeout(batchTimer)
  batchTimer = 0
  if (!activeStrokeId || sentPointCount >= activePoints.value.length) return
  const start = Math.max(0, sentPointCount - (sentPointCount > 0 ? 1 : 0))
  const unsent = activePoints.value.slice(start)
  for (let index = 0; index < unsent.length; index += APP_CONFIG.drawing.maxPointsPerBatch) {
    const points = unsent.slice(index, index + APP_CONFIG.drawing.maxPointsPerBatch)
    if (!points.length) continue
    emit('stroke', {
      kind: 'stroke',
      id: activeStrokeId,
      tool: props.tool === 'eraser' ? 'eraser' : 'pen',
      color: props.color,
      width: props.width,
      points,
      sequence: nextSequence(),
    })
  }
  sentPointCount = activePoints.value.length
}

/** 指针抬起或取消时冲刷自由笔画最后一个批次并清除本地预览。 */
function pointerUp(event: PointerEvent): void {
  if (!drawing.value) return
  canvas.value?.releasePointerCapture(event.pointerId)
  drawing.value = false
  flushPointBatch()
  activePoints.value = []
  activeStrokeId = ''
  sentPointCount = 0
  redraw()
}

/** 画笔或橡皮擦位于画板内时，滚轮调整二者共用的连续粗细值。 */
function wheelWidth(event: WheelEvent): void {
  if (!props.canDraw || props.tool === 'fill') return
  event.preventDefault()
  const direction = event.deltaY < 0 ? 1 : -1
  const next = Math.max(
    APP_CONFIG.drawing.width.min,
    Math.min(
      APP_CONFIG.drawing.width.max,
      props.width + direction * APP_CONFIG.drawing.width.wheelStep,
    ),
  )
  emit('widthChange', next)
}

watch(
  () => [props.strokes, props.undoneStrokeIds],
  () => nextTick(redraw),
  { deep: true },
)
watch(() => [props.tool, props.color, props.width], redraw)

onMounted(() => {
  observer = new ResizeObserver(resizeCanvas)
  if (canvas.value) observer.observe(canvas.value)
  resizeCanvas()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.clearTimeout(batchTimer)
})
</script>

<template>
  <canvas
    ref="canvas"
    class="drawing-canvas"
    :class="{ drawable: canDraw, erasing: tool === 'eraser', filling: tool === 'fill' }"
    :aria-label="
      canDraw
        ? '作画画布，支持画笔、橡皮擦、封闭区域填充和滚轮调整画笔或橡皮擦粗细'
        : '实时观看画布'
    "
    @pointerdown="pointerDown"
    @pointermove="pointerMove"
    @pointerup="pointerUp"
    @pointercancel="pointerUp"
    @wheel="wheelWidth"
  />
</template>
