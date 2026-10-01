<!--
  画笔大小数值控件：只显示当前参考像素值，不常驻预览圆点。
  鼠标悬停在控件上时隐藏系统指针，改为跟随指针、直径等于当前粗细的画笔圆点
  （cursor-none + 绝对定位圆点），滚轮直接调整粗细。数值用等宽数字与固定最小宽度，
  位数变化（5→10）不会推挤相邻控件。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'

const width = defineModel<number>({ required: true })
const props = withDefaults(
  defineProps<{
    /** 不可绘制（非画家 / 非作画阶段）时置灰并禁用滚轮与圆点。 */
    disabled?: boolean
    /** 画笔圆点的填充色（与当前画笔颜色一致）。 */
    color?: string
  }>(),
  { disabled: false, color: 'var(--color-navy)' },
)

const size = APP_CONFIG.drawing.width
const hovering = ref(false)
const pointer = ref({ x: 0, y: 0 })

/** 悬停圆点直径＝当前粗细参考像素值（与画布光标同语义：看到的圈＝画出的线）。 */
const previewDiameter = computed(() => Math.max(3, width.value))

function track(event: PointerEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  pointer.value = { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function onEnter(event: PointerEvent): void {
  if (props.disabled) return
  hovering.value = true
  track(event)
}

function onMove(event: PointerEvent): void {
  if (hovering.value) track(event)
}

function onLeave(): void {
  hovering.value = false
}

/** 滚轮只调整粗细，不让事件穿透到下方画布。 */
function onWheel(event: WheelEvent): void {
  event.preventDefault()
  event.stopPropagation()
  if (props.disabled) return
  const step = event.deltaY < 0 ? size.wheelStep : -size.wheelStep
  width.value = Math.max(size.min, Math.min(size.max, width.value + step))
}
</script>

<template>
  <div
    class="relative flex min-h-[4.4cqh] shrink-0 cursor-default items-center justify-center px-[0.4em]"
    :class="[disabled ? 'opacity-40' : '', hovering && !disabled ? 'cursor-none' : '']"
    :aria-label="strings.game.brushSize"
    :title="strings.game.brushWheelHint"
    @pointerenter="onEnter"
    @pointermove="onMove"
    @pointerleave="onLeave"
    @wheel="onWheel"
  >
    <output
      class="inline-flex items-baseline gap-[0.15em] font-mono text-fs-14 font-bold tabular-nums text-navy"
      :aria-label="`${strings.game.brushSize} ${width}${strings.game.brushUnit}`"
    >
      <span class="inline-block min-w-[2ch] text-center">{{ width }}</span>
      <small class="text-fs-10 text-muted">{{ strings.game.brushUnit }}</small>
    </output>
    <!-- 悬停画笔圆点：直径＝粗细值、跟随指针，纯预览不拦事件 -->
    <span
      v-if="hovering && !disabled"
      class="pointer-events-none absolute rounded-full border-[0.16cqh] border-navy/50"
      :style="{
        left: `${pointer.x}px`,
        top: `${pointer.y}px`,
        width: `${previewDiameter}px`,
        height: `${previewDiameter}px`,
        transform: 'translate(-50%, -50%)',
        backgroundColor: color,
      }"
      aria-hidden="true"
    ></span>
  </div>
</template>
