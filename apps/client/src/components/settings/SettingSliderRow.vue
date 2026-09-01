<!--
  可复用的滑块设置行：标题 + 说明 + 范围滑块 + 当前值展示。
  通过 v-model（modelValue + update:modelValue）双向绑定数值，拖拽结束时发出 save 由父级持久化。
-->
<script setup lang="ts">
// 标题、说明、当前值、滑块区间/步进与右侧展示文本均由调用方传入，保证行外观统一。
defineProps<{
  title: string
  hint: string
  modelValue: number
  min: number
  max: number
  step: number
  display: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: number]
  save: []
}>()

/**
 * 拖拽过程中实时发出新值（等价于原 v-model.number 的即时更新）。
 * range 的值是字符串，这里用 Number 还原为数值以保持数值语义。
 */
function onInput(event: Event): void {
  emit('update:modelValue', Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <label
    class="grid min-h-[8cqh] grid-cols-[1.2fr_1.8fr_auto] items-center gap-[1em] border-l-[0.4cqh] border-blue bg-white px-[1.2em] py-[1cqh]"
  >
    <span class="flex flex-col">
      <b>{{ title }}</b>
      <small class="text-muted text-[0.7em]">{{ hint }}</small>
    </span>
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      class="accent-blue"
      @input="onInput"
      @change="emit('save')"
    />
    <strong>{{ display }}</strong>
  </label>
</template>
