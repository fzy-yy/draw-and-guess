<!--
  图标按钮基座（仅结构，不含视觉）：type=button + aria-label + disabled + 类名合并 + 点击转发 + 默认插槽。
  IconButton / RoundIconButton / SquareIconButton 三个变体只保留各自的底座类与差异样式；
  文字或更复杂内容请使用 AppButton。
-->
<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue'
import { playInteractionSound, type InteractionAudioEvent } from '@/audio'
import { cn } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    /** 无障碍标签（图标按钮无可见文字，应提供；缺省不渲染 aria-label）。命名约定：图标按钮家族统一用 label prop（表单类原语用 ariaLabel），组件内部落到 aria-label；两种命名都是合法的可绑定 prop，此处只是约定，并非 Vue 对 aria-* 有限制。 */
    label?: string
    /** 禁用态。 */
    disabled?: boolean
    /** 变体底座类（尺寸/配色/激活态由各变体拼装后传入）。 */
    baseClass: string
    /** 交互音效语义；null 用于已有专属领域音效的操作。 */
    audioFeedback?: InteractionAudioEvent | null
  }>(),
  { label: undefined, disabled: false, audioFeedback: 'activate' },
)

// click 事件携带原生 MouseEvent：与全局组件属性扩展（vue-augmentations）签名一致，
// 避免 strictTemplates 下「零参 emit 声明 × 透传 onClick 扩展」交叉出无法赋值的处理器类型。
const emit = defineEmits<{ click: [event: MouseEvent] }>()

// 在 setup 顶层取响应式 attrs，供下方 computed 读取外部透传的 class（调用处可用 class 追加布局类）。
const attrs = useAttrs()
const button = ref<HTMLElement>()

// 底座 + 调用处透传的外部 class：只取 attrs.class，避免把 style/onClick 等键名当类名；
// 其余 attrs（style、事件、无障碍属性等）由 Vue 单根组件的隐式透传落到 <button> 上。
// 旧的 .touch-target/.compact-control 触控契约类已移除：命中区即视觉尺寸，控件随舞台等比缩放。
const buttonClass = computed(() => cn(props.baseClass, attrs.class))

/** 供带弹层的上层图标按钮在 Esc 关闭后恢复键盘焦点。 */
function focus(): void {
  button.value?.focus()
}

function handleClick(event: MouseEvent): void {
  if (props.audioFeedback) playInteractionSound(props.audioFeedback)
  emit('click', event)
}

defineExpose({ focus })
</script>

<template>
  <button
    ref="button"
    type="button"
    :aria-label="label"
    :disabled="disabled"
    :class="buttonClass"
    @click="handleClick"
  >
    <slot />
  </button>
</template>
