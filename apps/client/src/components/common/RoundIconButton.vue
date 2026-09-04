<!--
  圆形图标按钮：收敛 ActionPopover 触发钮与 ChatPanel 快捷短语按钮的圆形图标底座。
  仅承载图标；尺寸固定为 4.2cqh，disabled 时不透明降级。
  视觉类引用全局共享类 .round-icon-btn（见 style/index.css @layer components），
  与 ActionPopover 的触发按钮保持同一来源，避免两处样式漂移。
-->
<script setup lang="ts">
import BaseIconButton from '@/components/common/BaseIconButton.vue'

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
</script>

<template>
  <BaseIconButton
    :label="label"
    :disabled="disabled"
    base-class="round-icon-btn"
    @click="emit('click')"
  >
    <slot />
  </BaseIconButton>
</template>
