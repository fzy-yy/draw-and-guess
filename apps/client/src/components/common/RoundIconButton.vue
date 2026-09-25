<!--
  圆形图标按钮：收敛 ActionPopover 触发钮与 ChatPanel 快捷短语按钮的圆形图标底座。
  仅承载图标；尺寸固定为 4.2cqh，disabled 时不透明降级。
  视觉类引用全局共享类 .round-icon-btn（见 style/index.css @layer components），
  与 ActionPopover 的触发按钮保持同一来源，避免两处样式漂移。
-->
<script setup lang="ts">
import { ref } from 'vue'
import type { InteractionAudioEvent } from '@/audio'
import BaseIconButton from '@/components/common/BaseIconButton.vue'

withDefaults(
  defineProps<{
    /** 无障碍标签（无可见文字，必须提供）。注：不能用 ariaLabel——Vue 对 aria-* 恒透传，无法绑定为 prop。 */
    label: string
    /** 禁用态。 */
    disabled?: boolean
    /** 交互音效语义。 */
    audioFeedback?: InteractionAudioEvent | null
  }>(),
  { disabled: false, audioFeedback: 'activate' },
)
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const button = ref<InstanceType<typeof BaseIconButton>>()

/** ActionPopover 等组合组件通过此方法恢复触发按钮焦点。 */
function focus(): void {
  button.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <BaseIconButton
    ref="button"
    :label="label"
    :disabled="disabled"
    :audio-feedback="audioFeedback"
    base-class="round-icon-btn"
    @click="emit('click', $event)"
  >
    <slot />
  </BaseIconButton>
</template>
