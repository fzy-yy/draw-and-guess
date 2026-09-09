<!--
  可复用的开关设置行：标题 + 说明 + 复选框。
  通过 v-model（modelValue + update:modelValue）双向绑定布尔值，切换时发出 save 由父级持久化。
  额外的外观类（如左侧描边颜色/宽度）由调用处通过 class 传入，自动与内置类合并。
-->
<script setup lang="ts">
import { nextTick } from 'vue'
import { playInteractionSound } from '@/audio'

const model = defineModel<boolean>({ required: true })

defineProps<{
  title: string
  hint: string
}>()
const emit = defineEmits<{
  save: []
}>()

function save(): void {
  emit('save')
  // 静音开关本身也复用本组件；等待设置 watcher 同步管理器后再发音，保证关闭静音可听、开启静音不响。
  void nextTick(() => playInteractionSound('toggle'))
}
</script>

<template>
  <!-- v-bind="$attrs" 让调用处的 class 透传并自动与内置类合并。
       整行即命中区：touch-target 保证 ≥44×44，compact-control 保证低高度舞台下不缩到不可点。 -->
  <label
    class="touch-target compact-control flex min-h-[8cqh] items-center gap-[1em] bg-white px-[1.2em] py-[1cqh] cursor-pointer"
    v-bind="$attrs"
  >
    <span class="flex flex-1 flex-col">
      <b>{{ title }}</b>
      <small class="text-muted text-fs-12">{{ hint }}</small>
    </span>
    <!-- relative z-[1]：让复选框位于 .touch-target 伪元素之上，直接点击/自动化 check() 都能命中它 -->
    <input
      v-model="model"
      type="checkbox"
      class="relative z-[1] h-[max(2.6cqh,18px)] w-[max(2.6cqh,18px)] accent-blue"
      @change="save"
    />
  </label>
</template>
