<!--
  图标按钮基座（仅结构，不含视觉）：type=button + aria-label + disabled + 类名合并 + 点击转发 + 默认插槽。
  IconButton / RoundIconButton / ToolButton 三个变体只保留各自的底座类与差异样式；
  文字或更复杂内容请使用 AppButton。
-->
<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue'
import { cn } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    /** 无障碍标签（图标按钮无可见文字，应提供；缺省不渲染 aria-label）。注：不能用 ariaLabel 作为 prop——Vue 对 aria-* 属性恒透传，无法绑定为 prop。 */
    label?: string
    /** 禁用态。 */
    disabled?: boolean
    /** 变体底座类（尺寸/配色/激活态由各变体拼装后传入）。 */
    baseClass: string
  }>(),
  { label: undefined, disabled: false },
)

const emit = defineEmits<{ click: [] }>()

// 在 setup 顶层取响应式 attrs，供下方 computed 读取外部透传的 class（调用处可用 class 追加布局类）。
const attrs = useAttrs()
const button = ref<HTMLElement>()

// 底座 + 调用处透传的外部 class：只取 attrs.class，避免把 style/onClick 等键名当类名；
// 其余 attrs（style、事件、无障碍属性等）由 Vue 单根组件的隐式透传落到 <button> 上。
const buttonClass = computed(() => cn(props.baseClass, attrs.class))

/** 供带弹层的上层图标按钮在 Esc 关闭后恢复键盘焦点。 */
function focus(): void {
  button.value?.focus()
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
    @click="emit('click')"
  >
    <slot />
  </button>
</template>
