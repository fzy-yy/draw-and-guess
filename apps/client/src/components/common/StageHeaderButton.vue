<!--
  顶栏通用胶囊按钮组件（原语）：
  专用于 StageHeader 顶栏内的操作与状态按钮（设置、退出、返回以及网络状态等）。
  - 规范统一的高度（4.6cqh）、圆角（rounded-[0.6em]）、内边距（px-[0.8em]）与图标尺寸；
  - 统一文字排印（text-fs-14 + 加粗 font-bold）；
  - 统一交互反馈（.ui-feedback 动效 + 点击音效）；
  - 根元素类名支持通过 class 透传经 cn() 自动合并，允许外部或业务变体定制色彩（如网络状态指示）。
-->
<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { playInteractionSound, type InteractionAudioEvent } from '@/audio'
import { cn, type ClassValue } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    /** 原生按钮类型，默认 button */
    type?: 'button' | 'submit' | 'reset'
    /** 禁用态 */
    disabled?: boolean
    audioFeedback?: InteractionAudioEvent | null
    /** 使用方追加的类名 */
    class?: ClassValue
  }>(),
  {
    type: 'button',
    disabled: false,
    audioFeedback: 'activate',
    class: undefined,
  },
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()

const attrs = useAttrs()

/** 顶栏按钮标准底座类：包含几何、字体、图标尺寸约束与交互动效。 */
const buttonClass = computed(() =>
  cn(
    'ui-feedback inline-flex h-[4.6cqh] shrink-0 items-center justify-center gap-[0.4em] rounded-[0.6em] bg-white/10 px-[0.8em] text-fs-14 font-bold text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40 [&>svg]:h-[2.6cqh] [&>svg]:w-[2.6cqh] [&>svg]:shrink-0',
    props.class,
    attrs.class,
  ),
)

function handleClick(event: MouseEvent): void {
  if (props.audioFeedback) {
    playInteractionSound(props.audioFeedback)
  }
  emit('click', event)
}
</script>

<template>
  <button :type="type" :disabled="disabled" :class="buttonClass" @click="handleClick">
    <slot />
  </button>
</template>
