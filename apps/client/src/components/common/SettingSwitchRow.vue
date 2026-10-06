<!--
  可复用的开关设置行：标题 + 说明 + 复选框。
  通过 v-model（modelValue + update:modelValue）双向绑定布尔值，切换时发出 save 由父级持久化。
  额外的外观类（如左侧描边颜色/宽度）由调用处通过 class 传入，自动与内置类合并。
-->
<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { playInteractionSound } from '@/audio'
import { cn, type ClassValue } from '@/utils/cn'

const model = defineModel<boolean>({ required: true })

const props = defineProps<{
  title: string
  hint: string
  class?: ClassValue
}>()
const emit = defineEmits<{
  save: []
}>()

function save(): void {
  emit('save')
  void nextTick(() => playInteractionSound('toggle'))
}

const rootClass = computed(() =>
  cn(
    'flex min-h-[8cqh] items-center gap-[1em] bg-white px-[1.2em] py-[1cqh] cursor-pointer',
    props.class,
  ),
)
</script>

<template>
  <label :class="rootClass">
    <span class="flex flex-1 flex-col">
      <b>{{ title }}</b>
      <small class="text-muted text-fs-12">{{ hint }}</small>
    </span>
    <input
      v-model="model"
      type="checkbox"
      class="h-[max(2.6cqh,16px)] w-[max(2.6cqh,16px)] accent-blue"
      @change="save"
    />
  </label>
</template>
