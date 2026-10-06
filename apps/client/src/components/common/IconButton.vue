<!--
  通用方块图标按钮：收敛各视图顶端操作组（设置、全屏、退出等）的长串行内类。
  仅承载图标；文字或更复杂内容请使用 AppButton。尺寸提供 default（4.4cqh）与 lg（4.6cqh）两档。
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { InteractionAudioEvent } from '@/audio'
import { cn, type ClassValue } from '@/utils/cn'
import BaseIconButton from '@/components/common/BaseIconButton.vue'

const props = withDefaults(
  defineProps<{
    /** 无障碍标签（按钮无可见文字，必须提供）。命名约定：图标按钮家族统一用 label prop（表单类原语用 ariaLabel），组件内部落到 aria-label；aria-* 本可正常绑定为 prop，用 label 只是家族约定。 */
    label: string
    /** 尺寸变体：default 用于对局 HUD，lg 用于房间顶栏。 */
    size?: 'default' | 'lg'
    /** 禁用态（如房间顶栏退出按钮在非等待阶段禁用）。 */
    disabled?: boolean
    /** 交互音效语义。 */
    audioFeedback?: InteractionAudioEvent | null
    /** 原生 type，默认 button */
    type?: 'button' | 'submit' | 'reset'
    /** 使用方追加的类名 */
    class?: ClassValue
  }>(),
  { size: 'default', disabled: false, audioFeedback: 'activate', type: 'button', class: undefined },
)
// click 携带 MouseEvent：与 BaseIconButton/全局 onClick 扩展签名一致（见 vue-augmentations.d.ts）
const emit = defineEmits<{ click: [event: MouseEvent] }>()

// 方块图标按钮：尺寸纯按 cqh 等比缩放（旧 compact-control-square 44px 保底已随触控契约移除）。
const baseClass = computed(() =>
  cn(
    'grid place-items-center rounded-[0.6em] bg-white/10 text-white disabled:cursor-not-allowed disabled:opacity-40',
    props.size === 'lg' ? 'h-[4.6cqh] w-[4.6cqh]' : 'h-[4.4cqh] w-[4.4cqh]',
  ),
)
</script>

<template>
  <BaseIconButton
    :type="type"
    :label="label"
    :disabled="disabled"
    :audio-feedback="audioFeedback"
    :base-class="baseClass"
    :class="props.class"
    @click="emit('click', $event)"
  >
    <slot />
  </BaseIconButton>
</template>
