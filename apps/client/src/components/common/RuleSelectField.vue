<!--
  规则/表单下拉字段（标签 + SelectDropdown 的最小通用结构，与 RuleToggleField 同组）。
  v-model 绑定字段值，options 为统一选项数组（值类型与字段一致：数字选项保留 number 语义）。
  内部控件已从原生 <select> 换为手写 SelectDropdown 原语（统一视觉与键盘交互）；
  字段标签经 span id + aria-labelledby 关联到 combobox。
-->
<script setup lang="ts" generic="V extends string | number">
import { computed, useId } from 'vue'
import { cn, type ClassValue } from '@/utils/cn'
import SelectDropdown, { type SelectDropdownOption } from './SelectDropdown.vue'

export type RuleSelectOption<V extends string | number = string | number> = SelectDropdownOption<V>

const props = withDefaults(
  defineProps<{
    label: string
    options: readonly SelectDropdownOption<V>[]
    disabled?: boolean
    /** 使用方追加的类名 */
    class?: ClassValue
  }>(),
  { disabled: false, class: undefined },
)
const model = defineModel<V>({ required: true })
/** 标签元素 id：useId 保证多实例共存时关联不串台。 */
const labelId = `${useId()}-label`
const rootClass = computed(() =>
  cn(
    'min-w-0 flex flex-col gap-[0.5cqh] text-fs-14 font-bold',
    props.disabled && 'opacity-60',
    props.class,
  ),
)
</script>

<template>
  <div :class="rootClass">
    <span :id="labelId">{{ label }}</span>
    <SelectDropdown v-model="model" :options="options" :disabled="disabled" :labelledby="labelId" />
  </div>
</template>
