<!--
  高 DPI 实时画板。
  自由笔画按批次发送；区域填充只提交归一化点击位置和颜色，由每个客户端按同一历史确定像素区域。
  坐标始终归一化为 0～1，因此窗口缩放和断线重建不会使绘图位置漂移。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import {
  type DrawingCommand,
  type DrawPoint,
  type FillCommand,
  type Stroke,
  type ToolKind,
} from '@draw-guess/shared'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { createUuid } from '@/utils/createUuid'

const props = defineProps<{
  /** 当前回合 ID；变化时必须清空像素缓冲，不能只按命令数量判断。 */
  roundId: string
  strokes: DrawingCommand[]
  undoneStrokeIds: string[]
  /** 服务端已接受的最大绘图序号（从对局快照获取），用于本地序号续起对齐。 */
  lastSequence: number
  canDraw: boolean
  tool: ToolKind
  color: string
  width: number
  /** 画布渲染代次：同 ID 笔画追加点不会改变命令数组长度，由该代次触发增量绘制。 */
  revision?: number
}>()
const emit = defineEmits<{
  stroke: [stroke: Stroke]
  fill: [fill: FillCommand]
  widthChange: [width: number]
}>()

const canvas = ref<HTMLCanvasElement>() // 画布 DOM 引用
const activePoints = ref<DrawPoint[]>([]) // 当前未提交的自由笔画本地点列
const drawing = ref(false) // 是否正在按下画布绘图
let observer: ResizeObserver | undefined // 画布尺寸监听（窗口缩放重建像素缓冲）
let sequence = 0 // 本地绘图序号（提交时与权威历史比较取更大值）
let activeStrokeId = '' // 当前按下动作的笔画 ID（各批次共用）
/**
 * 当前笔画的样式快照（按下瞬间锁定）。
 * 服务端对同一 `strokeId` 只接受首批的 tool/color/width（后续批次仅追加点），
 * 若各批次沿用实时 props，中途切工具/改色/滚轮改粗细会造成本地预览与其他端权威画面不一致
 * （例如本地变透明擦除、其他端仍是画笔线）。因此一律以本快照为准。
 */
let activeStyle: { tool: 'pen' | 'eraser'; color: string; width: number } | null = null

/** 取在画笔画的样式快照；无活跃笔画时回退到实时 props（防御式，正常不会命中）。 */
function currentStrokeStyle(): { tool: 'pen' | 'eraser'; color: string; width: number } {
  return (
    activeStyle ?? {
      tool: props.tool === 'eraser' ? 'eraser' : 'pen',
      color: props.color,
      width: props.width,
    }
  )
}
let sentPointCount = 0 // 已发送到服务端的点数（用于切片增量）
// 批次发送定时器改为由 @vueuse/core 的 useTimeoutFn 管理：start 会先清理旧定时器再重排，
// isPending 表示当前是否已有待触发的定时器，组件卸载时自动清理（见 onBeforeUnmount）。
const {
  isPending: batchPending,
  start: startBatchTimer,
  stop: stopBatchTimer,
} = useTimeoutFn(flushPointBatch, APP_CONFIG.drawing.batchIntervalMs, { immediate: false })

/** 过滤掉已撤销的命令，得到实际应重绘的可见历史。 */
const visibleCommands = computed(() =>
  props.strokes.filter((command) => !props.undoneStrokeIds.includes(command.id)),
)

/** 画布像素缓冲尺寸：按设备像素比缩放并封顶 2.0，限制填充类大内存分配的上限。 */
function resizeCanvas(): void {
  const element = canvas.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const ratio = Math.min(window.devicePixelRatio || 1, 2.0)
  element.width = Math.max(1, Math.round(rect.width * ratio))
  element.height = Math.max(1, Math.round(rect.height * ratio))
  redraw()
}

/**
 * 绘制自由笔画；橡皮擦使用 destination-out 做透明擦除，并与画笔共用 width。
 * fromIndex 表示从第几个采样点开始绘制（用于增量绘制局部笔画，0 = 从头画））。
 */
function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke, fromIndex = 0): void {
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
  // 从 fromIndex-1 起笔，保证与上一段线段连续（首段从 0 起）
  const start = Math.max(0, fromIndex - 1)
  const first = stroke.points[start]
  if (!first) {
    context.restore()
    return
  }
  context.moveTo(first.x * canvasWidth, first.y * canvasHeight)
  for (const point of stroke.points.slice(start + 1))
    context.lineTo(point.x * canvasWidth, point.y * canvasHeight)
  if (stroke.points.length === 1)
    context.lineTo(first.x * canvasWidth + 0.01, first.y * canvasHeight + 0.01)
  else if (start >= 1 && stroke.points.length - start === 1 && stroke.points[start - 1]) {
    // 追加单点时补一条极短线段让笔迹可见
    const previous = stroke.points[start - 1]!
    context.lineTo(
      previous.x * canvasWidth + (first.x - previous.x) * canvasWidth + 0.01,
      previous.y * canvasHeight + (first.y - previous.y) * canvasHeight + 0.01,
    )
  }
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

/** 取画布 2D 上下文（绘图/填充需频繁读像素）。 */
function getContext(): CanvasRenderingContext2D | null {
  return canvas.value?.getContext('2d', { willReadFrequently: true }) ?? null
}

// —— E2 增量绘制游标：避免高频笔画（约 40 批/秒）每次都全量重绘 1500 条历史 ——
let committedCount = 0 // 已绘制到画布的可见命令数
let committedUndoLen = props.undoneStrokeIds.length // 上次已绘制时的撤销栈长度
let committedRoundId = props.roundId // 上次完成绘制的回合，用于识别“等长历史替换”
const drawnPoints = new Map<string, number>() // strokeId → 本画布已绘制的点数（-1 表示填充命令已画）

/** 清空并依序重绘权威历史，再叠加尚未提交完毕的本地自由笔画；重绘后重置增量游标。 */
function redraw(): void {
  const context = getContext()
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
      ...currentStrokeStyle(),
      points: activePoints.value,
      sequence,
    })
  }
  // 登记已绘制游标：撤销等结构变化后必须全量重绘，游标随之重建
  drawnPoints.clear()
  for (const command of visibleCommands.value)
    drawnPoints.set(command.id, command.kind === 'stroke' ? command.points.length : -1)
  committedCount = visibleCommands.value.length
  committedRoundId = props.roundId
  // 重新登记“正在画的这条笔画”的已绘点数：否则由缩放/撤销等触发的中途 redraw 之后、
  // 下一次 pointerMove 之前到达的服务端回显会以 prev=0 从头重绘整条在画笔画，
  // 造成抗锯齿边缘加深、橡皮路径重复擦除。
  if (activeStrokeId && activePoints.value.length)
    drawnPoints.set(activeStrokeId, activePoints.value.length)
  committedUndoLen = props.undoneStrokeIds.length
}

/**
 * 增量绘制服务端新到达的命令或同 ID 追加点。
 * 遍历全部可见命令，按“服务端点数 > 本画布已绘点数”判断是否需要补画：
 * - 新命令：fromIndex=0 全量绘制；
 * - 同 ID 追加（含交错笔画）：从已绘点数起补画新增段，保证长笔画分批到达也不会缺段。
 * 跳过本地预览已覆盖的点（画家本地画的点数 ≥ 服务端确认点数），避免笔迹重复加深。
 */
function drawIncoming(context: CanvasRenderingContext2D): void {
  const visible = visibleCommands.value
  for (const command of visible) {
    if (command.kind === 'fill') {
      if (drawnPoints.has(command.id)) continue
      drawFill(context, command)
      drawnPoints.set(command.id, -1)
      continue
    }
    const prev = drawnPoints.get(command.id) ?? 0
    if (command.points.length > prev) {
      drawStroke(context, command, prev)
      drawnPoints.set(command.id, command.points.length)
    }
  }
  // 增量路径也必须推进已提交游标；否则清空时 0 < committedCount 会因游标仍为 0 而失效。
  committedCount = visible.length
  committedRoundId = props.roundId
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
  // 基准取：本地序号 +1、服务端 lastSequence +1、历史命令最大序号 +1 三者的最大值
  sequence = Math.max(
    sequence + 1,
    props.lastSequence + 1,
    ...props.strokes.map((command) => command.sequence + 1),
    0,
  )
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
  canvas.value?.setPointerCapture(event.pointerId) // 捕获指针，支持在组件外持续绘制
  drawing.value = true
  activeStrokeId = createUuid()
  // 锁定本笔样式快照，整条笔画（含所有批次与预览重绘）均沿用按下瞬间的 tool/color/width
  activeStyle = {
    tool: props.tool === 'eraser' ? 'eraser' : 'pen',
    color: props.color,
    width: props.width,
  }
  sentPointCount = 0
  activePoints.value = [point]
  // 同步登记本地已画点数：服务端回写同 ID 点时按此跳过，防止笔迹加深
  drawnPoints.set(activeStrokeId, 1)
  // 本地预览立即画出落笔点
  const context = getContext()
  if (context)
    drawStroke(context, {
      kind: 'stroke',
      id: 'local-preview',
      ...currentStrokeStyle(),
      points: activePoints.value,
      sequence,
    })
  // 启动批次发送周期：按下后定期把新采样点批量上传
  startBatchTimer()
}

/** 指针移动时为自由笔画追加经过距离去抖的采样点，并增量绘制新增点段。 */
function pointerMove(event: PointerEvent): void {
  if (!drawing.value || !props.canDraw) return
  const point = normalizedPoint(event)
  const previous = activePoints.value.at(-1)
  // 距离过近的去抖：避免一帧内产生大量重复点
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0015) return
  const from = activePoints.value.length
  activePoints.value.push(point)
  drawnPoints.set(activeStrokeId, activePoints.value.length)
  // 本地预览增量绘制新增点段（只画末尾这一小段）
  const context = getContext()
  if (context)
    drawStroke(
      context,
      {
        kind: 'stroke',
        id: 'local-preview',
        ...currentStrokeStyle(),
        points: activePoints.value,
        sequence,
      },
      from,
    )
  // 批次周期外的新点也触发一次批次发送（仅在无待触发定时器时重排，避免每次移动重置倒计时）
  if (!batchPending.value) startBatchTimer()
}

/** 每个配置批处理周期仅发送自由笔画新增点，既保证实时性也限制网络事件量。 */
function flushPointBatch(): void {
  // useTimeoutFn 在定时器触发后已自动将 isPending 置为 false 并清除句柄，无需手动清理
  if (!activeStrokeId || sentPointCount >= activePoints.value.length) return
  const start = Math.max(0, sentPointCount - (sentPointCount > 0 ? 1 : 0))
  const unsent = activePoints.value.slice(start)
  for (let index = 0; index < unsent.length; index += APP_CONFIG.drawing.maxPointsPerBatch) {
    const points = unsent.slice(index, index + APP_CONFIG.drawing.maxPointsPerBatch)
    if (!points.length) continue
    emit('stroke', {
      kind: 'stroke',
      id: activeStrokeId,
      ...currentStrokeStyle(),
      points,
      sequence: nextSequence(),
    })
  }
  sentPointCount = activePoints.value.length
}

/** 指针抬起或取消时冲刷自由笔画最后一个批次并清除本地预览（已画像素保留在画布）。 */
function pointerUp(event: PointerEvent): void {
  if (!drawing.value) return
  // 先清理状态再释放捕获：pointercancel 时浏览器已隐式释放捕获（指针也可能已失效），
  // 无条件调用可能抛 InvalidPointerId/NotFoundError，若放在前面会使 drawing 卡在 true，
  // 后续 pointerMove 就会不断往这条“幽灵笔画”加点并发批次。
  drawing.value = false
  flushPointBatch()
  activePoints.value = []
  activeStrokeId = ''
  activeStyle = null
  sentPointCount = 0
  if (canvas.value?.hasPointerCapture(event.pointerId))
    canvas.value.releasePointerCapture(event.pointerId)
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

/**
 * 权威历史变化监听：
 * - 撤销栈长度变化 / 命令数减少（撤销、清空、回合切换）→ 全量重绘并重建游标；
 * - 其余情况（笔画批次、同 ID 追加点、填充）→ 增量绘制，避免每帧全量重绘历史。
 * revision 代次保证同 ID 追加点也能可靠触发（命令数组长度不变时普通 watch 不会触发）。
 */
watch(
  () => [
    props.roundId,
    props.strokes.length,
    props.revision ?? 0,
    props.undoneStrokeIds.length,
    props.undoneStrokeIds.at(-1),
  ],
  () => {
    const roundChanged = props.roundId !== committedRoundId
    if (roundChanged) {
      // 回合切换可能发生在指针仍按下时，旧回合的本地预览不能被重画到新画布。
      drawing.value = false
      activePoints.value = []
      activeStrokeId = ''
      activeStyle = null
      sentPointCount = 0
      stopBatchTimer()
    }
    const visibleIds = new Set(visibleCommands.value.map((command) => command.id))
    const hasRemovedCommand = [...drawnPoints.keys()].some(
      (id) => id !== activeStrokeId && !visibleIds.has(id),
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
    if (!context) return
    drawIncoming(context)
  },
  { deep: true },
)

// 注：不再监听 tool/color/width 去重绘预览。一条笔画的样式在按下时已锁定（见 activeStyle），
// 中途改工具/颜色/粗细不应改变正在画的这条笔画，否则本地与其他端的权威历史会不一致。

onMounted(() => {
  observer = new ResizeObserver(resizeCanvas)
  if (canvas.value) observer.observe(canvas.value)
  resizeCanvas()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  // useTimeoutFn 已在组件卸载时自动清理定时器，这里显式调用（幂等）以保持原有清理语义
  stopBatchTimer()
})
</script>

<template>
  <!-- 画布元素：绑定指针/滚轮事件；canDraw 时显示不同光标（绘画/橡皮/填充） -->
  <canvas
    ref="canvas"
    class="block h-full w-full bg-white [touch-action:none]"
    :class="{
      'cursor-crosshair': canDraw && tool !== 'eraser' && tool !== 'fill',
      'cursor-cell': canDraw && tool === 'eraser',
      'cursor-copy': canDraw && tool === 'fill',
    }"
    :aria-label="canDraw ? strings.canvas.drawingAria : strings.canvas.watchingAria"
    @pointerdown="pointerDown"
    @pointermove="pointerMove"
    @pointerup="pointerUp"
    @pointercancel="pointerUp"
    @wheel="wheelWidth"
  />
</template>
