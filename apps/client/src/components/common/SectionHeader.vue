<!--
  分区标题头（可复用）：眉题（eyebrow）+ 标题（h2）的组合结构。
  收敛 Lobby/Room/Settings/弹窗等页面中大量重复的「眉题 + 标题」两行排布，
  保证全站分区标题视觉一致；纯展示组件，不含任何布局外逻辑。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { cn, type ClassValue } from '@/utils/cn'

const props = withDefaults(
  defineProps<{
    /** 眉题（小号英文/装饰字，如「ROOMS」「PLAYERS」） */
    eyebrow: string
    /** 标题文案（一级分区标题） */
    title: string
    /** 标题 id（弹窗 labelledby 等锚点场景使用，可选） */
    id?: string
    /** 使用方追加的类名 */
    class?: ClassValue
  }>(),
  {
    id: undefined,
    class: undefined,
  },
)

const rootClass = computed(() => cn('min-w-0', props.class))
</script>

<template>
  <div :class="rootClass">
    <p class="eyebrow">{{ eyebrow }}</p>
    <h2 :id="id">{{ title }}</h2>
  </div>
</template>
