<!--
  方形图标按钮（纸白底版）：对局顶栏的面板开关与底部工具条按钮共用同一底座与激活态。
  与深色顶栏操作组使用的 IconButton 区分——IconButton 是 navy 底上的半透明白按钮，
  本组件是纸白底 + 深蓝描边，用于 navy 顶栏的开关簇与画布上的工具条，两类底座不混用。
  内容（图标）经默认插槽传入；按钮无可见文字，label 同时作为 aria-label 与悬浮提示。
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { InteractionAudioEvent } from '@/audio'
import { cn, type ClassValue } from '@/utils/cn'
import BaseIconButton from '@/components/common/BaseIconButton.vue'

const props = withDefaults(
  defineProps<{
    /** 无障碍标签（按钮无可见文字，必须提供；可含快捷键等更完整描述）。 */
    label: string
    /** 悬浮提示文案；缺省复用 label（工具条上 label 含快捷键、title 只写工具名时需分开传）。 */
    title?: string
    /** 激活态：面板已展开或当前工具已选中。 */
    active?: boolean
    /** 禁用态：工具条在非画家或非作画阶段整组置灰。 */
    disabled?: boolean
    /** 交互音效语义；工具切换通常传 select。 */
    audioFeedback?: InteractionAudioEvent | null
    /** 原生 type，默认 button */
    type?: 'button' | 'submit' | 'reset'
    /** 使用方追加的类名 */
    class?: ClassValue
  }>(),
  {
    title: undefined,
    active: false,
    disabled: false,
    audioFeedback: 'activate',
    type: 'button',
    class: undefined,
  },
)
// click 携带 MouseEvent：与 BaseIconButton/全局 onClick 扩展签名一致（见 vue-augmentations.d.ts）
const emit = defineEmits<{ click: [event: MouseEvent] }>()

// 尺寸随舞台等比缩放（cqh），不做像素保底；禁用态由透明度表达。
const baseClass = computed(() =>
  cn(
    'relative grid aspect-square h-[4.4cqh] w-[4.4cqh] shrink-0 place-items-center rounded-[0.45em] border-[0.22cqh]',
    props.active
      ? 'border-navy bg-blue text-white'
      : 'border-navy bg-paper/95 text-navy hover:bg-sky',
    props.disabled ? 'cursor-not-allowed opacity-40' : '',
  ),
)
</script>

<template>
  <BaseIconButton
    :type="type"
    :label="label"
    :title="title ?? label"
    :disabled="disabled"
    :audio-feedback="audioFeedback"
    :base-class="baseClass"
    :class="props.class"
    @click="emit('click', $event)"
  >
    <slot />
  </BaseIconButton>
</template>
