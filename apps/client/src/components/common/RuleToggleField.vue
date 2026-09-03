<!--
  规则表单横排开关字段（可复用）：左侧复选框 + 标签，整行可点。
  收敛房间规则弹窗中 6 处重复的「横排 checkbox + 文案」结构；
  v-model 双向绑定布尔值，组件不感知业务字段。
-->
<script setup lang="ts">
defineProps<{
  /** 字段标签文案（来自 strings） */
  label: string
  modelValue: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

/** 复选框切换：把勾选状态即时上抛给父级（父级持有草稿状态）。 */
function onToggle(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <label
    class="min-w-0 flex min-h-[4.8cqh] flex-row items-center gap-[0.5cqh] rounded-[0.5em] bg-line px-[0.8em] text-[0.76em] font-extrabold"
  >
    <input
      type="checkbox"
      class="h-[2.2cqh] w-[2.2cqh] accent-blue"
      :checked="modelValue"
      @change="onToggle"
    />
    {{ label }}
  </label>
</template>
