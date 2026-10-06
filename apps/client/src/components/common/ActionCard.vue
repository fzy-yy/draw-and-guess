<!--
  统一操作导航卡片（ActionCard）：
  收敛大厅建房/私密加入快捷卡片与房间规则中词库/规则条目的手写样式。
  
  支持三种语义变体：
  - primary: 蓝色实底白字，用于大厅建房等主要操作
  - navy: 藏青实底白字，用于私密加房等次级主要操作
  - sky: 浅蓝底蓝字带左侧描边，用于房间规则中的词库管理等条目入口
  
  完全符合 docs/Vue组件开发规范.md：
  - M1: 仅通过四个插座（props, emits, slots）暴露对外契约
  - M2: 严格类型 Props 与默认值声明
  - M4: 严格类型 Emits 声明
  - M5: 声明 class prop，并通过 cn() 进行 Tailwind 冲突消解，其余属性透传根元素
  - M7/M8: 完整 Tailwind 字面量变体表与 cn() 消解
  - S9: 语义化变体命名，严格使用设计令牌
  - S10: 交互态统一通过 Tailwind 变体与 ui-feedback 共享类表达
-->
<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { playInteractionSound, type InteractionAudioEvent } from '@/audio'
import { cn, type ClassValue } from '@/utils/cn'

export type ActionCardVariant = 'primary' | 'navy' | 'sky'

interface Props {
  /** 主标题文案 */
  title?: string
  /** 辅提示说明文案 */
  hint?: string
  /** 视觉变体：primary(蓝底)/navy(藏青底)/sky(浅蓝底带左边框) */
  variant?: ActionCardVariant
  /** 禁用态 */
  disabled?: boolean
  /** 按钮原生类型，默认 button 避免在表单中意外触发表单提交 */
  type?: 'button' | 'submit'
  /** 交互音效，默认 activate */
  audioFeedback?: InteractionAudioEvent | null
  /** 使用方追加的类名，冲突时覆盖组件默认样式 */
  class?: ClassValue
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  hint: '',
  variant: 'primary',
  disabled: false,
  type: 'button',
  audioFeedback: 'activate',
  class: undefined,
})

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

defineSlots<{
  /** 左侧前置图标 */
  icon?: () => unknown
  /** 自定义标题内容 */
  title?: () => unknown
  /** 自定义副标题内容 */
  hint?: () => unknown
  /** 右侧后缀区域，默认渲染 ChevronRight 图标 */
  trailing?: () => unknown
}>()

/**
 * 完整字面量变体映射表（严格符合 M7 规范，禁止运行时类名拼接）
 */
const variantClasses: Record<
  ActionCardVariant,
  {
    root: string
    icon: string
    title: string
    hint: string
    trailing: string
  }
> = {
  primary: {
    root: 'flex min-h-[12cqh] items-center gap-[1em] rounded-[0.9em] bg-blue px-[1.4em] text-left text-white ui-feedback',
    icon: 'flex shrink-0 items-center justify-center [&>svg]:h-[4.5cqh] [&>svg]:w-[4.5cqh] [&>svg]:text-yellow',
    title: 'text-fs-18 font-bold leading-tight',
    hint: 'mt-[0.35cqh] text-sky text-fs-12 leading-tight',
    trailing: 'ml-auto text-white shrink-0',
  },
  navy: {
    root: 'flex min-h-[12cqh] items-center gap-[1em] rounded-[0.9em] bg-navy px-[1.4em] text-left text-white ui-feedback',
    icon: 'flex shrink-0 items-center justify-center [&>svg]:h-[4.5cqh] [&>svg]:w-[4.5cqh] [&>svg]:text-yellow',
    title: 'text-fs-18 font-bold leading-tight',
    hint: 'mt-[0.35cqh] text-sky text-fs-12 leading-tight',
    trailing: 'ml-auto text-white shrink-0',
  },
  sky: {
    root: 'flex min-h-[7cqh] items-center gap-[0.75em] py-[0.8cqh] px-[0.8em] text-blue bg-sky border-l-[0.45cqh] border-l-blue text-left ui-feedback',
    icon: 'flex shrink-0 items-center justify-center text-blue [&>svg]:h-[3cqh] [&>svg]:w-[3cqh]',
    title: 'text-fs-14 font-bold truncate leading-tight',
    hint: 'text-muted text-fs-12 leading-tight',
    trailing: 'ml-auto text-muted shrink-0 [&>svg]:h-[2.5cqh] [&>svg]:w-[2.5cqh]',
  },
}

const currentVariant = computed(() => variantClasses[props.variant])

const rootClass = computed(() =>
  cn(currentVariant.value.root, props.disabled && 'cursor-not-allowed opacity-50', props.class),
)

function handleClick(event: MouseEvent): void {
  if (props.disabled) return
  if (props.audioFeedback) playInteractionSound(props.audioFeedback)
  emit('click', event)
}
</script>

<template>
  <button :type="type" :disabled="disabled" :class="rootClass" v-bind="$attrs" @click="handleClick">
    <span v-if="$slots.icon" :class="currentVariant.icon">
      <slot name="icon" />
    </span>
    <span class="flex min-w-0 flex-1 flex-col">
      <slot name="title">
        <b :class="currentVariant.title">{{ title }}</b>
      </slot>
      <slot name="hint">
        <small v-if="hint" :class="currentVariant.hint">{{ hint }}</small>
      </slot>
    </span>
    <span :class="currentVariant.trailing">
      <slot name="trailing">
        <ChevronRight class="h-current w-current" />
      </slot>
    </span>
  </button>
</template>
