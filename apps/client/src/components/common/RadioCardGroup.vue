<!--
  单选卡片组表单原语（RadioCardGroup）：
  收敛房间创建弹窗及各类设置中手写的「单选卡片列表」结构。
  
  完全符合 docs/Vue组件开发规范.md：
  - M1: 仅通过四个插座（props, emits, slots, defineModel）暴露对外契约
  - M2: 严格类型 Props 与默认值声明（支持泛型值类型）
  - M3: 双向绑定使用 defineModel<V>()，不直接修改 props
  - M4: 严格类型 Emits 声明
  - M5: 声明 class prop，并通过 cn() 进行样式合并
  - M6: 选项 v-for 绑定稳定唯一的 key
  - M7/M8: 完整 Tailwind 字面量变体表与 cn() 消解
  - S9: 严格使用设计系统色彩与偶数字号标尺
  - S10: 交互态统一通过 Tailwind 变体与原生 label 关联
-->
<script setup lang="ts" generic="V extends string | number">
import { computed, useId } from 'vue'
import { playInteractionSound, type InteractionAudioEvent } from '@/audio'
import { cn, type ClassValue } from '@/utils/cn'

export interface RadioCardOption<T extends string | number = string | number> {
  value: T
  title: string
  hint?: string
  disabled?: boolean
}

interface Props {
  /** 单选组标题说明（fieldset legend） */
  label?: string
  /** 选项列表 */
  options: readonly RadioCardOption<V>[]
  /** 栅格列数，默认 2 列 */
  columns?: 1 | 2 | 3 | 4
  /** 整组禁用 */
  disabled?: boolean
  /** 交互音效，默认 select */
  audioFeedback?: InteractionAudioEvent | null
  /** 使用方追加的类名 */
  class?: ClassValue
}

const props = withDefaults(defineProps<Props>(), {
  label: undefined,
  columns: 2,
  disabled: false,
  audioFeedback: 'select',
  class: undefined,
})

const model = defineModel<V>({ required: true })

const emit = defineEmits<{
  change: [value: V]
}>()

defineSlots<{
  title?: (slotProps: { option: RadioCardOption<V> }) => unknown
  hint?: (slotProps: { option: RadioCardOption<V> }) => unknown
}>()

const groupName = useId()

const columnClasses: Record<1 | 2 | 3 | 4, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
}

const rootClass = computed(() =>
  cn('col-span-full m-0 grid gap-[0.8em] border-0 p-0', columnClasses[props.columns], props.class),
)

function handleChange(val: V): void {
  if (props.audioFeedback) playInteractionSound(props.audioFeedback)
  emit('change', val)
}
</script>

<template>
  <fieldset :class="rootClass" role="radiogroup">
    <legend v-if="label" class="col-span-full mb-[0.7cqh] font-bold text-navy">
      {{ label }}
    </legend>
    <label
      v-for="option in options"
      :key="String(option.value)"
      :class="
        cn(
          'flex items-center gap-[0.7em] rounded-[0.7em] border-[0.18cqh] border-control bg-white px-[1em] py-[1cqh] transition-colors',
          disabled || option.disabled
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer hover:border-blue',
          model === option.value && 'border-blue bg-sky/30',
        )
      "
    >
      <input
        v-model="model"
        type="radio"
        :name="groupName"
        :value="option.value"
        :disabled="disabled || option.disabled"
        class="h-[2.2cqh] w-[2.2cqh] accent-blue disabled:cursor-not-allowed"
        @change="handleChange(option.value)"
      />
      <span class="flex flex-col">
        <slot name="title" :option="option">
          <b class="text-navy leading-tight">{{ option.title }}</b>
        </slot>
        <slot name="hint" :option="option">
          <small v-if="option.hint" class="text-muted text-fs-12 leading-tight">
            {{ option.hint }}
          </small>
        </slot>
      </span>
    </label>
  </fieldset>
</template>
