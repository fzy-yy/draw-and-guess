<!--
  规则/表单下拉字段（label + select 的最小通用结构，与 RuleSliderField/RuleToggleField 同组）。
  v-model 绑定字段值，options 为统一选项数组（值类型与字段一致：数字选项保留 number 语义）；
  额外的辅助说明（如最大值提示）经默认插槽放在选择框下方。
-->
<script setup lang="ts" generic="V extends string | number">
import { playInteractionSound } from '@/audio'

export interface RuleSelectOption<V extends string | number> {
  value: V
  label: string
}

defineProps<{
  label: string
  options: readonly RuleSelectOption<V>[]
  disabled?: boolean
}>()
const model = defineModel<V>({ required: true })
</script>

<template>
  <!-- 触控契约已废除：label 上不得挂任何覆盖层类（旧 .touch-target 的 ::after 会拦截指针事件，
       导致原生 <select> 收不到点击、下拉框彻底无法展开——即本次修复的缺陷根因）。
       字段行仅保持原生 label 关联：点标签聚焦控件，点控件本体展开下拉。 -->
  <label class="min-w-0 flex flex-col gap-[0.5cqh] text-fs-14 font-bold">
    {{ label }}
    <select
      v-model="model"
      :disabled="disabled"
      class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-control bg-white px-[1em] font-bold text-navy"
      @change="playInteractionSound('select')"
    >
      <option v-for="option in options" :key="String(option.value)" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <slot />
  </label>
</template>
