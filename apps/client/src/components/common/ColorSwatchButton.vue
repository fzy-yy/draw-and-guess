<!--
  圆形色板按钮：预设色块与自定义取色共用同一选中环。
  - 预设色：paint 指定底色，点击后向父组件抛出 select(颜色)；
  - 自定义取色：custom 为真时在 label 内嵌隐藏的原生 color 输入（点击 label 直接命中控件，
    避免 showPicker 的浏览器兼容差异），输入变化同样抛出 select。
  两种模式对辅助技术暴露同一套语义：label 恒为 role=button（自定义模式的原生输入对辅助技术
  隐藏，只作点击实现细节），选中环与焦点行为因此完全一致。
  选中态统一用 focus 令牌描外环 + navy 边框，保证两种模式视觉一致。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { cn } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    /** 悬浮提示文案，同时作为无障碍标签的缺省值。 */
    label: string
    /** 无障碍标签；缺省复用 label。自定义取色的提示语含「画笔 / 填充」等工具名，需与工具按钮区分语义。 */
    ariaLabel?: string
    /** 选中态：显示统一选中环。 */
    selected?: boolean
    /** 预设色值；custom 为真时仅作为取色器初始值。 */
    paint?: string
    /** 禁用态。 */
    disabled?: boolean
    /** 自定义取色模式：渲染隐藏的原生 color 输入。 */
    custom?: boolean
  }>(),
  { ariaLabel: undefined, selected: false, paint: undefined, disabled: false, custom: false },
)
const emit = defineEmits<{
  select: [color: string]
  commit: [color: string]
}>()

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
  emit('commit', props.paint)
}

/** 自定义取色器的原生 input 事件（连续拖拽滑动中静音预览）。 */
function onColorInput(event: Event): void {
  emit('select', (event.target as HTMLInputElement).value)
}

/** 自定义取色器的原生 change 事件（光标松开或关闭选择器时确认提交）。 */
function onColorChange(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  emit('select', value)
  emit('commit', value)
}

/** 自定义模式下内嵌的原生取色控件；键盘激活时用它展开取色器。 */
const colorInput = ref<HTMLInputElement>()

/**
 * 键盘激活（Enter/Space）：预设色直接选中；自定义色展开原生取色器。
 * label 自身不响应键盘激活，鼠标点击由 label→input 原生关联完成，两条路径互不干扰。
 */
function activateByKeyboard(): void {
  if (props.disabled) return
  if (props.custom) {
    colorInput.value?.click()
    return
  }
  selectPreset()
}
</script>

<template>
  <label
    :class="rootClass"
    :style="paint && !custom ? { '--paint': paint } : undefined"
    role="button"
    :tabindex="disabled ? -1 : 0"
    :aria-label="ariaLabel ?? label"
    :title="label"
    :aria-disabled="disabled || undefined"
    @click="selectPreset"
    @keydown.enter.prevent="activateByKeyboard"
    @keydown.space.prevent="activateByKeyboard"
  >
    <slot />
    <!-- 原生 color 输入只作点击实现细节：鼠标点击由 label 原生关联触发，对辅助技术隐藏。 -->
    <input
      v-if="custom"
      ref="colorInput"
      type="color"
      tabindex="-1"
      aria-hidden="true"
      class="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0"
      :value="paint"
      :disabled="disabled"
      @input="onColorInput"
      @change="onColorChange"
    />
  </label>
</template>
