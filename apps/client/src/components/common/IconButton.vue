<!--
  通用方块图标按钮：收敛各视图顶端操作组（暂停/恢复、设置、全屏、退出等）的长串行内类。
  仅承载图标；文字或更复杂内容请使用 AppButton。尺寸提供 default（4.4cqh）与 lg（4.6cqh）两档。
-->
<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { cn } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    /** 无障碍标签（按钮无可见文字，必须提供）。注：不能用 ariaLabel 作为 prop——Vue 对 aria-* 属性恒透传，无法绑定为 prop。 */
    label: string
    /** 尺寸变体：default 用于对局 HUD，lg 用于房间顶栏。 */
    size?: 'default' | 'lg'
    /** 禁用态（如房间顶栏退出按钮在非等待阶段禁用）。 */
    disabled?: boolean
  }>(),
  { size: 'default', disabled: false },
)

const emit = defineEmits<{ click: [] }>()

// 在 setup 顶层取响应式 attrs，供下方 computed 读取外部透传的 class（调用处可用 class 追加布局类）。
const attrs = useAttrs()

// 底座 + 尺寸 + 调用处透传的外部 class：只取 attrs.class，避免把 style/onClick 等键名当类名。
const buttonClass = computed(() =>
  cn(
    'grid place-items-center rounded-[0.6em] bg-white/10 text-white',
    props.size === 'lg' ? 'h-[4.6cqh] w-[4.6cqh]' : 'h-[4.4cqh] w-[4.4cqh]',
    attrs.class,
  ),
)
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :disabled="disabled"
    :class="buttonClass"
    v-bind="attrs"
    @click="emit('click')"
  >
    <slot />
  </button>
</template>
