<!--
  圆形色板按钮：预设色块与自定义取色共用同一选中环。
  - 预设色：paint 指定底色，点击后向父组件抛出 select(颜色)；
  - 自定义取色：custom 为真时在 label 内嵌隐藏的原生 color 输入（点击 label 直接命中控件，
    避免 showPicker 的浏览器兼容差异），输入变化同样抛出 select。
  选中态统一用 focus 令牌描外环 + navy 边框，保证两种模式视觉一致。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    /** 无障碍标签与悬浮提示。 */
    label: string
    /** 选中态：显示统一选中环。 */
    selected?: boolean
    /** 预设色值；custom 为真时仅作为取色器初始值。 */
    paint?: string
    /** 禁用态。 */
    disabled?: boolean
    /** 自定义取色模式：渲染隐藏的原生 color 输入。 */
    custom?: boolean
  }>(),
  { selected: false, paint: undefined, disabled: false, custom: false },
)
const emit = defineEmits<{ select: [color: string] }>()

// 色板属密集控件：仅保留 16px 视觉下限（responsive.minDenseTargetPx），其余随舞台等比缩放。
const rootClass = computed(() =>
  cn(
    'relative grid aspect-square h-[max(2.9cqh,16px)] w-[max(2.9cqh,16px)] shrink-0 place-items-center rounded-full border-[0.16cqh]',
    props.selected
      ? 'border-navy outline-[0.26cqh] outline-focus outline-offset-[0.1cqh]'
      : 'border-control',
    props.custom ? 'cursor-pointer bg-white' : props.paint ? 'bg-(--paint)' : 'bg-white',
    props.disabled ? 'cursor-not-allowed opacity-40' : '',
  ),
)

/** 预设色点击：custom 模式由内嵌 input 自行处理，这里只处理预设色。 */
function selectPreset(): void {
  if (props.disabled || props.custom || !props.paint) return
  emit('select', props.paint)
}

/** 自定义取色器的原生 input 事件（转回字符串）。 */
function onColorInput(event: Event): void {
  emit('select', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <label
    :class="rootClass"
    :style="paint && !custom ? { '--paint': paint } : undefined"
    :aria-label="label"
    :title="label"
    :aria-disabled="disabled || undefined"
    :role="custom ? undefined : 'button'"
    :tabindex="custom ? undefined : 0"
    @click="selectPreset"
    @keydown.enter.prevent="selectPreset"
    @keydown.space.prevent="selectPreset"
  >
    <slot />
    <input
      v-if="custom"
      type="color"
      class="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0"
      :value="paint"
      :disabled="disabled"
      :aria-label="label"
      @input="onColorInput"
    />
  </label>
</template>
