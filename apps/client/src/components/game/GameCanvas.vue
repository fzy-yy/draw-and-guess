<!--
  高 DPI 实时画板装配层。
  权威历史的回放决策、世代取代、后备缓冲与逻辑层簿记全部委托给 DrawingReplayMachine
  （ADR-0018）；本组件只做三件事：props 快照转发进机器、指针事件接线、投影 DOM。
  视口、光标与单次笔画会话由 composables 管理；填充提交锁在 useFillSession，
  渲染态由机器经 onRenderingChange 报告，两者在此合成填充门禁。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Brush,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Flame,
  HelpCircle,
  MessageSquareQuote,
  PaintBucket,
  Pipette,
  Redo2,
  ThumbsUp,
  Trash2,
  Undo2,
} from 'lucide-vue-next'
import {
  EVENTS,
  type DrawingCommand,
  type FillCommand,
  type Stroke,
  type StrokeAck,
  type ToolKind,
  type CanvasPingType,
} from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { recordFillDiagnostic } from '@/canvas/fill-diagnostics'
import { FloodFillWorkerClient } from '@/canvas/flood-fill-worker'
import { DrawingReplayMachine } from '@/canvas/replay-machine'
import { presentLogicalCanvas } from '@/canvas/viewport'
import { useCanvasCursor } from '@/composables/useCanvasCursor'
import { useCanvasViewport } from '@/composables/useCanvasViewport'
import { useContextMenu, type ContextMenuItem } from '@/composables/useContextMenu'
import { useFillSession, type FillAck } from '@/composables/useFillSession'
import { useStrokeSession } from '@/composables/useStrokeSession'
import type { PendingStrokeBatch } from '@/composables/useStrokeSession'
import { useToasts } from '@/composables/useToasts'
import { useGameStore } from '@/stores/game'
import type { RequestFailure, RequestResult } from '@/stores/request'

const width = defineModel<number>('width', { required: true })
const tool = defineModel<ToolKind>('tool', { default: 'pen' })
const color = defineModel<string>('color', { default: '#1a1a1a' })
const showToolbar = defineModel<boolean>('showToolbar', { default: true })

const props = defineProps<{
  roundId: string
  strokes: DrawingCommand[]
  undoneStrokeIds: string[]
  lastSequence: number
  canDraw: boolean
  /**
   * 权威画布修订号（协议必选整数：GameView 绑定 `game.drawingRevision`，
   * RoomSnapshot 的 game schema 中 drawingRevision 无 optional）。
   * 填充提交锁解锁判定与 watch 触发集共用，唯一绑定点即恒有值，故为必填 prop。
   */
  revision: number
}>()

const emit = defineEmits<{
  stroke: [stroke: Stroke, onResult: (result: RequestResult<StrokeAck>) => void]
  strokeFailure: [batch: PendingStrokeBatch, failure: RequestFailure]
  fill: [fill: FillCommand, onResult: (result: RequestResult<FillAck>) => void]
  /** 重放所需的填充无法在本地完成：父层据此请求权威全量快照。 */
  fillFailure: []
  /** 触发二次确认弹窗清空画板。 */
  clear: []
}>()
const canvas = ref<HTMLCanvasElement>()
/** 渲染态（有填充任务在重放计算）由机器回调报告；与提交锁合成 canFill 门禁。 */
const rendering = ref(false)
// 填充计算端口的生产适配器：常驻 Worker + 一次性主线程降级（ADR-0009）。
// Worker 生命周期仍由本组件管理——机器只认端口，不认线程。
const fillWorker = new FloodFillWorkerClient()
const machine = new DrawingReplayMachine(
  {
    present: (surface) => {
      if (canvas.value) presentLogicalCanvas(surface, canvas.value)
    },
    onRenderingChange: (busy) => {
      rendering.value = busy
    },
    onFillFailure: () => {
      recordFillDiagnostic('fill_unavailable')
      emit('fillFailure')
    },
  },
  fillWorker,
  { roundId: props.roundId, undoCount: props.undoneStrokeIds.length },
)
// 初始快照先登记进机器（此时逻辑层尚未定尺寸，重放留待挂载时 viewport 的首次 resize 触发）：
// 断线恢复/刷新直达对局时，挂载即有历史，不能只靠后续 watch。
// 这里读取 props 是一次性初始快照（后续更新由下方 watch 驱动），并非响应式丢失。
// eslint-disable-next-line vue/no-setup-props-reactivity-loss
machine.sync({
  commands: props.strokes,
  undoneIds: props.undoneStrokeIds,
  roundId: props.roundId,
})

const fillSession = useFillSession({
  revision: () => props.revision,
  roundId: () => props.roundId,
})

const strokeSession = useStrokeSession({
  canvas,
  width,
  canDraw: () => props.canDraw,
  canFill: () => !rendering.value && !fillSession.submitPending.value,
  tool: () => tool.value,
  color: () => color.value,
  roundId: () => props.roundId,
  lastSequence: () => props.lastSequence,
  preview: machine,
  emitStroke: (stroke, onResult) => emit('stroke', stroke, onResult),
  onBatchFailure: (batch, failure) => emit('strokeFailure', batch, failure),
  emitFill: (fill) => {
    // 提交锁绑定发起时的回合：旧回合的迟到 ack 由 settleSubmit 按回合丢弃。
    const roundId = props.roundId
    fillSession.beginSubmit()
    emit('fill', fill, (result) => fillSession.settleSubmit(result, roundId))
  },
})
const { resizeTick } = useCanvasViewport(canvas, machine.logicalCanvas, (w, h) =>
  machine.resize(w, h),
)

// E2E 只读探针：在展示层画布上暴露「权威命令计数」（客户端镜像的 DrawingCommand 条数），
// 供 09 用例按命令数推进到上限，而不是靠固定点击次数 + Toast 时序猜测。
// 与 __logicalCanvas 同一开关：默认生产构建不包含，E2E 构建由 launcher 注入 VITE_EXPOSE_LOGICAL_CANVAS=1。
onMounted(() => {
  const element = canvas.value
  if (element && (import.meta.env.DEV || import.meta.env.VITE_EXPOSE_LOGICAL_CANVAS === '1')) {
    Object.defineProperty(element, '__authoritativeCommandCount', {
      configurable: true,
      get: () => props.strokes.length,
    })
  }
})
const cursor = useCanvasCursor({
  canvas,
  width,
  tool: () => tool.value,
  color: () => color.value,
  canDraw: () => props.canDraw,
  resizeTick,
})

const store = useGameStore()
const contextMenu = useContextMenu()
const toasts = useToasts()

/** 是否处于吸管取色单次采样模式 */
const isEyedropping = ref(false)

/** 右键点击时记录的归一化相对画布坐标（0~1） */
const contextMenuNormalizedPos = ref<{ x: number; y: number }>({ x: 0.5, y: 0.5 })

/** 本地画板临时气泡项接口 */
interface CanvasBubbleItem {
  id: number
  x: number
  y: number
  type: CanvasPingType
  senderNickname: string
}

/** 画板本地临时气泡队列（上限 6 个，超出自动淘汰最旧气泡） */
const canvasBubbles = ref<CanvasBubbleItem[]>([])
let bubbleSequence = 0

/** 将表情类型映射为展示 Emoji */
function reactionEmoji(type: CanvasPingType): string {
  if (type === 'thumbs_up') return '👍'
  if (type === 'confused') return '❓'
  return '🔥'
}

/** 向画板添加微表情气泡 */
function pushCanvasBubble(bubble: Omit<CanvasBubbleItem, 'id'>): void {
  const id = ++bubbleSequence
  const newBubble: CanvasBubbleItem = { ...bubble, id }
  // 上限严格限制为最多 6 个，超出时自动淘汰最旧气泡
  if (canvasBubbles.value.length >= 6) {
    canvasBubbles.value.shift()
  }
  canvasBubbles.value.push(newBubble)

  // 持续 1.2 秒向上浮起淡出后自动销毁
  setTimeout(() => {
    canvasBubbles.value = canvasBubbles.value.filter((b) => b.id !== id)
  }, 1200)
}

/** 监听全局微表情推送广播 */
watch(
  () => store.latestCanvasPing,
  (ping) => {
    if (!ping) return
    pushCanvasBubble({
      x: ping.x,
      y: ping.y,
      type: ping.type,
      senderNickname: ping.senderNickname,
    })
  },
)

/** 发送画板微表情（使用右键时的归一化坐标） */
function sendReactionPing(type: CanvasPingType): void {
  const { x, y } = contextMenuNormalizedPos.value
  void store.sendCanvasPing(x, y, type)
}

/** 是否允许画布微表情互动（房间设置） */
const allowReactions = computed(() => store.room?.settings.allowCanvasReactions ?? true)

/**
 * 生成语义化画作文件名：draw-and-guess-YYYY-MM-DD-HH-mm-ss.png。
 */
function formatDrawingFileName(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours(),
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `draw-and-guess-${stamp}.png`
}

/**
 * 将当前逻辑画布内容保存为 PNG 文件下载。
 */
function downloadCanvasImage(): void {
  const logical = machine.logicalCanvas
  const dataUrl = logical.toDataURL('image/png')
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = formatDrawingFileName()
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  toasts.notify(strings.ui.game.canvasSavedAsImage, 'success')
}

/** 画家专属右键菜单项 */
const drawerMenuItems = computed<ContextMenuItem[]>(() => {
  const activeTool = tool.value
  const hasStrokes = props.strokes.length > 0
  const hasUndone = props.undoneStrokeIds.length > 0

  return [
    // 基础绘图工具组
    {
      id: 'tool-pen',
      label: strings.ui.game.canvasMenuBrush,
      icon: Brush,
      disabled: activeTool === 'pen' && !isEyedropping.value,
      action: () => {
        isEyedropping.value = false
        tool.value = 'pen'
      },
    },
    {
      id: 'tool-eraser',
      label: strings.ui.game.canvasMenuEraser,
      icon: Eraser,
      disabled: activeTool === 'eraser',
      action: () => {
        isEyedropping.value = false
        tool.value = 'eraser'
      },
    },
    {
      id: 'tool-fill',
      label: strings.ui.game.canvasMenuFill,
      icon: PaintBucket,
      disabled: activeTool === 'fill',
      action: () => {
        isEyedropping.value = false
        tool.value = 'fill'
      },
    },
    {
      id: 'tool-eyedropper',
      label: strings.ui.game.canvasMenuEyedropper,
      icon: Pipette,
      disabled: isEyedropping.value,
      action: () => {
        isEyedropping.value = true
      },
    },
    // 历史命令组
    {
      id: 'history-undo',
      label: strings.ui.game.canvasMenuUndo,
      icon: Undo2,
      separatorBefore: true,
      disabled: !hasStrokes,
      action: () => {
        void store.drawAction(EVENTS.drawUndo)
      },
    },
    {
      id: 'history-redo',
      label: strings.ui.game.canvasMenuRedo,
      icon: Redo2,
      disabled: !hasUndone,
      action: () => {
        void store.drawAction(EVENTS.drawRedo)
      },
    },
    // 工具栏显隐
    {
      id: 'toggle-toolbar',
      label: showToolbar.value
        ? strings.ui.game.canvasMenuHideToolbar
        : strings.ui.game.canvasMenuShowToolbar,
      icon: showToolbar.value ? EyeOff : Eye,
      separatorBefore: true,
      action: () => {
        showToolbar.value = !showToolbar.value
      },
    },
    // 保存画作
    {
      id: 'export-save',
      label: strings.ui.game.canvasMenuSave,
      icon: Download,
      action: () => {
        downloadCanvasImage()
      },
    },
    // 清空画板危险项
    {
      id: 'history-clear',
      label: strings.ui.game.canvasMenuClear,
      icon: Trash2,
      danger: true,
      separatorBefore: true,
      disabled: !hasStrokes,
      action: () => {
        emit('clear')
      },
    },
  ]
})

/** 猜词者 / 观战者专属右键菜单项 */
const guesserMenuItems = computed<ContextMenuItem[]>(() => {
  const items: ContextMenuItem[] = [
    {
      id: 'export-save',
      label: strings.ui.game.canvasMenuSave,
      icon: Download,
      action: () => {
        downloadCanvasImage()
      },
    },
  ]
  // 微表情互动组（点赞 👍、满头问号 ❓、神仙画画 🔥）
  items.push(
    {
      id: 'reaction-thumbs_up',
      label: strings.ui.game.canvasMenuReactionThumbsUp,
      icon: ThumbsUp,
      disabled: !allowReactions.value,
      separatorBefore: true,
      action: () => {
        sendReactionPing('thumbs_up')
      },
    },
    {
      id: 'reaction-confused',
      label: strings.ui.game.canvasMenuReactionConfused,
      icon: HelpCircle,
      disabled: !allowReactions.value,
      action: () => {
        sendReactionPing('confused')
      },
    },
    {
      id: 'reaction-fire',
      label: strings.ui.game.canvasMenuReactionFire,
      icon: Flame,
      disabled: !allowReactions.value,
      action: () => {
        sendReactionPing('fire')
      },
    },
  )

  // 快捷发言短语列表
  const safePhrases = store.config.presets.safeChat
  if (safePhrases && safePhrases.length > 0) {
    items.push({
      id: 'phrase-divider',
      label: strings.ui.game.canvasMenuQuickPhrases,
      separatorBefore: true,
      disabled: true,
    })
    for (const phrase of safePhrases) {
      items.push({
        id: `phrase-${phrase}`,
        label: phrase,
        icon: MessageSquareQuote,
        action: () => {
          void store.sendPreset(phrase)
        },
      })
    }
  }

  return items
})

/**
 * 右键点击拦截处理。
 */
function handleContextMenu(event: MouseEvent): void {
  // 作画中（正在拖拽划线）彻底忽略并阻止右键，防止打断快速划线
  if (strokeSession.drawing.value) return

  // 记录右键点击相对画布的归一化坐标 [0, 1]
  const rect = canvas.value?.getBoundingClientRect()
  if (rect && rect.width > 0 && rect.height > 0) {
    const nx = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const ny = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    contextMenuNormalizedPos.value = { x: nx, y: ny }
  }

  const items = props.canDraw ? drawerMenuItems.value : guesserMenuItems.value
  contextMenu.open(event, items, { ariaLabel: strings.a11y.game.canvasMenuAria })
}

/**
 * 从逻辑画布指定归一化坐标采样颜色。
 */
function pickColorAtNormalized(point: { x: number; y: number }): string {
  const logical = machine.logicalCanvas
  const ctx = logical.getContext('2d', { willReadFrequently: true })
  if (!ctx || logical.width <= 0 || logical.height <= 0) return color.value
  const px = Math.min(Math.max(0, Math.floor(point.x * logical.width)), logical.width - 1)
  const py = Math.min(Math.max(0, Math.floor(point.y * logical.height)), logical.height - 1)
  const pixel = ctx.getImageData(px, py, 1, 1).data
  if (pixel[3] === 0) return '#ffffff'
  const r = (pixel[0] ?? 0).toString(16).padStart(2, '0')
  const g = (pixel[1] ?? 0).toString(16).padStart(2, '0')
  const b = (pixel[2] ?? 0).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

/**
 * 画板点击事件分发：吸管采样拦截或转发给 strokeSession。
 */
function handlePointerDown(event: PointerEvent): void {
  if (isEyedropping.value) {
    const rect = canvas.value?.getBoundingClientRect()
    if (rect && rect.width > 0 && rect.height > 0) {
      const nx = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      const ny = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      const picked = pickColorAtNormalized({ x: nx, y: ny })
      color.value = picked
    }
    isEyedropping.value = false
    tool.value = 'pen'
    return
  }
  strokeSession.pointerDown(event)
}

// 回放决策（增量补画 vs 整帧重放）、世代与簿记全在机器内部；本 watch 的触发集
// 与旧版逐项一致（引用/长度/修订/撤销集），仅承担「快照转发 + 回合切换清会话」两件事。
// 仅取进入时的初始回合号作变更基准，后续变更由下方 watch 比较，并非响应式丢失。
// eslint-disable-next-line vue/no-setup-props-reactivity-loss
let lastRoundId = props.roundId
watch(
  () => [
    props.roundId,
    props.strokes,
    props.strokes.length,
    props.revision,
    props.undoneStrokeIds.length,
    props.undoneStrokeIds.at(-1),
  ],
  () => {
    if (props.roundId !== lastRoundId) {
      lastRoundId = props.roundId
      strokeSession.reset()
      // 旧回合的在途确认与超时兜底一律作废，避免新回合被旧回合的填充门禁卡住。
      fillSession.reset()
    }
    // 权威修订追平 ack 修订即解锁：与是否需要重放无关（重放由机器负责）。
    fillSession.syncRevision()
    machine.sync({
      commands: props.strokes,
      undoneIds: props.undoneStrokeIds,
      roundId: props.roundId,
    })
  },
)

function handlePointerMove(event: PointerEvent): void {
  cursor.cursorTrack(event)
  strokeSession.pointerMove(event)
}

onBeforeUnmount(() => {
  fillSession.reset()
  machine.dispose()
  fillWorker.dispose()
})
</script>

<template>
  <div
    class="relative h-full w-full"
    :class="{
      'cursor-none': cursor.showCursorDot.value && !isEyedropping,
      'cursor-crosshair': isEyedropping,
      'cursor-copy': canDraw && tool === 'fill' && !isEyedropping,
    }"
    @pointerenter="cursor.cursorEnter"
    @pointerleave="cursor.cursorLeave"
    @contextmenu.prevent="handleContextMenu"
  >
    <canvas
      ref="canvas"
      data-canvas-layer="display"
      class="block h-full w-full bg-white touch-none"
      :aria-label="canDraw ? strings.a11y.canvas.drawingAria : strings.a11y.canvas.watchingAria"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="strokeSession.pointerUp"
      @pointercancel="strokeSession.pointerUp"
      @wheel="strokeSession.wheelWidth"
    />
    <i
      v-if="cursor.showCursorDot.value && !isEyedropping"
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
    <!-- 画布全员轻量微表情浮动气泡（1.2s 向上浮起淡出） -->
    <div
      v-for="bubble in canvasBubbles"
      :key="bubble.id"
      class="pointer-events-none absolute z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center select-none animate-[score-float-up_1.2s_ease-out_forwards]"
      :style="{
        left: `${bubble.x * 100}%`,
        top: `${bubble.y * 100}%`,
      }"
    >
      <span class="text-fs-28 drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
        {{ reactionEmoji(bubble.type) }}
      </span>
      <span
        v-if="bubble.senderNickname"
        class="rounded bg-navy/70 px-1 py-0.5 text-fs-10 text-white font-bold shadow-sm backdrop-blur-xs whitespace-nowrap"
      >
        {{ bubble.senderNickname }}
      </span>
    </div>
  </div>
</template>
