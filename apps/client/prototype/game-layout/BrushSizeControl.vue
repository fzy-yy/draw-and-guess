<!--
  原型画笔粗细控制（不使用滑条）：
  数字直接显示当前参考像素值，旁边的小圆点提供视觉尺寸预览；鼠标滚轮悬停在控件上
  或直接滚动画布都改写同一个 width ref，GameCanvas 的真实画笔光标因此同步变大/变小。
  为什么不放滑条：面板可拖动、显隐与画布覆盖关系较复杂，固定滑条会在反复重排时
  改变视觉锚点；固定宽度的数值控件不会因值变化而挤动相邻工具，也能避免误拖。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { labels } from './labels.ts'

const width = defineModel<number>({ required: true })
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const size = APP_CONFIG.drawing.width
const sampleDiameter = computed(() => Math.max(3, width.value * 0.9))

/** 滚轮只驱动画笔尺寸，不让事件穿透到覆盖层下面的画布。 */
function adjustByWheel(event: WheelEvent): void {
  event.preventDefault()
  event.stopPropagation()
  const step = event.deltaY < 0 ? size.step : -size.step
  width.value = Math.max(size.min, Math.min(size.max, width.value + step))
}
</script>

<template>
  <div
    class="flex shrink-0 items-center gap-[0.45em] rounded-[0.55em] border-[0.18cqh] border-line bg-white"
    :class="props.compact ? 'px-[0.45em] py-[0.3em]' : 'px-[0.75em] py-[0.55em]'"
    :aria-label="strings.game.widthAria"
    :title="labels.brushSizeWheel"
    @wheel="adjustByWheel"
  >
    <span
      class="shrink-0 rounded-full bg-navy"
      :style="{ width: `${sampleDiameter}px`, height: `${sampleDiameter}px` }"
      aria-hidden="true"
    ></span>
    <!-- tabular-nums + 固定宽度，5→10 等位数变化时工具栏不会横向错位。 -->
    <output
      class="inline-flex min-w-[4.2em] items-baseline justify-center gap-[0.18em] font-mono text-fs-14 font-bold tabular-nums text-navy"
      :aria-label="`${strings.game.widthAria} ${width}${labels.brushSizeUnit}`"
    >
      <span>{{ width }}</span>
      <small class="text-fs-10 text-muted">{{ labels.brushSizeUnit }}</small>
    </output>
  </div>
</template>
