<!--
  设置页分区头部（图标 + 标题 + 说明段），声音/显示与操作/快捷键三个标签页共用。
  资料与诊断页因标题在卡片内部而非分区头部，不复用本组件。
-->
<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  /** 分区图标（lucide 组件）。 */
  icon: Component
  /** 分区标题。 */
  title: string
  /** 分区说明文案。 */
  intro: string
}>()
</script>

<template>
  <div class="mb-[2.5cqh] flex items-center gap-[1.2em]">
    <div
      class="grid h-[6cqh] w-[6cqh] place-items-center rounded-[0.8em] bg-blue text-white"
      aria-hidden="true"
    >
      <component :is="icon" class="h-[60%] w-[60%]" />
    </div>
    <div>
      <h2>{{ title }}</h2>
      <p class="mt-[0.5cqh] text-muted text-fs-12">{{ intro }}</p>
    </div>
  </div>
</template>
