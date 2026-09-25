<!--
  高 DPI 实时画板装配层。
  权威历史的回放决策、世代取代、后备缓冲与逻辑层簿记全部委托给 DrawingReplayMachine
  （ADR-0018）；本组件只做三件事：props 快照转发进机器、指针事件接线、投影 DOM。
  视口、光标与单次笔画会话由 composables 管理；填充提交锁在 useFillSession，
  渲染态由机器经 onRenderingChange 报告，两者在此合成填充门禁。
-->
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import {
  EVENTS,
  type ClientResponse,
  type DrawingCommand,
  type FillCommand,
  type Stroke,
  type StrokeAck,
  type ToolKind,
} from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { recordFillDiagnostic } from '@/canvas/fill-diagnostics'
import { FloodFillWorkerClient } from '@/canvas/flood-fill-worker'
import { DrawingReplayMachine } from '@/canvas/replay-machine'
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
/** 填充 ack 携带服务端画布修订，用于判断本地是否已追平并安全解除提交锁。 */
type FillAck = ClientResponse<typeof EVENTS.drawFillCommit>

const emit = defineEmits<{
  stroke: [stroke: Stroke, onResult: (result: RequestResult<StrokeAck>) => void]
  strokeFailure: [batch: PendingStrokeBatch, failure: RequestFailure]
  fill: [fill: FillCommand, onResult: (result: RequestResult<FillAck>) => void]
  /** 重放所需的填充无法在本地完成：父层据此请求权威全量快照。 */
  fillFailure: []
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
machine.sync({
  commands: props.strokes,
  undoneIds: props.undoneStrokeIds,
  roundId: props.roundId,
})

const fillSession = useFillSession({
  revision: () => props.revision ?? 0,
  roundId: () => props.roundId,
})

const strokeSession = useStrokeSession({
  canvas,
  width,
  canDraw: () => props.canDraw,
  canFill: () => !rendering.value && !fillSession.submitPending.value,
  tool: () => props.tool,
  color: () => props.color,
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
const cursor = useCanvasCursor({
  canvas,
  width,
  tool: () => props.tool,
  color: () => props.color,
  canDraw: () => props.canDraw,
  resizeTick,
})

// 回放决策（增量补画 vs 整帧重放）、世代与簿记全在机器内部；本 watch 的触发集
// 与旧版逐项一致（引用/长度/修订/撤销集），仅承担「快照转发 + 回合切换清会话」两件事。
let lastRoundId = props.roundId
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
