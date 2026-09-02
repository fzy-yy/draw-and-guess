<!--
  圆形图标按钮：收敛 ActionPopover 触发钮与 ChatPanel 快捷短语按钮的圆形图标底座。
  仅承载图标；尺寸固定为 4.2cqh，disabled 时不透明降级。
-->
<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { cn } from '@/utils/cn'

withDefaults(
  defineProps<{
    /** 无障碍标签（无可见文字，必须提供）。注：不能用 ariaLabel——Vue 对 aria-* 恒透传，无法绑定为 prop。 */
    label: string
    /** 禁用态。 */
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{ click: [] }>()
const attrs = useAttrs()

const buttonClass = computed(() =>
  cn(
    'grid h-[4.2cqh] w-[4.2cqh] shrink-0 place-items-center rounded-full border-[0.18cqh] border-line bg-white text-blue disabled:cursor-not-allowed disabled:opacity-40',
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
