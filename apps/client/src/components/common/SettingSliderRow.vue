<!--
  可复用的滑块设置行：标题 + 说明 + 范围滑块 + 当前值展示。
  通过 v-model（modelValue + update:modelValue）双向绑定数值，拖拽结束时发出 save 由父级持久化。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { playInteractionSound } from '@/audio'
import { cn, type ClassValue } from '@/utils/cn'

const model = defineModel<number>({ required: true })

// 标题、说明、当前值、滑块区间/步进与右侧展示文本均由调用方传入，保证行外观统一。
const props = defineProps<{
  title: string
  hint: string
  min: number
  max: number
  step: number
  display: string
  class?: ClassValue
}>()
const emit = defineEmits<{
  save: []
}>()

/**
 * 拖拽过程中实时发出新值（等价于原 v-model.number 的即时更新）。
 * range 的值是字符串，这里用 Number 还原为数值以保持数值语义。
 */
function onInput(event: Event): void {
  model.value = Number((event.target as HTMLInputElement).value)
}

function save(): void {
  playInteractionSound('select')
  emit('save')
}
const rootClass = computed(() =>
  cn(
    'grid min-h-[8cqh] grid-cols-[1.2fr_1.8fr_auto] items-center gap-[1em] border-l-[0.4cqh] border-blue bg-white px-[1.2em] py-[1cqh]',
    props.class,
  ),
)
</script>

<template>
  <!-- 滑块命中区由自身承担：label 上不得挂任何覆盖层类（伪元素会盖住 range，
       range 只响应指针按下/拖拽，label 只转发 click，滑块将完全无法拖动）。
       尺寸不设像素保底，随舞台等比缩放。 -->
  <label :class="rootClass">
    <span class="flex flex-col">
      <b>{{ title }}</b>
      <small class="text-muted text-fs-12">{{ hint }}</small>
    </span>
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="model"
      class="h-[2.75em] accent-blue"
      @input="onInput"
      @change="save"
    />
    <strong>{{ display }}</strong>
  </label>
</template>
