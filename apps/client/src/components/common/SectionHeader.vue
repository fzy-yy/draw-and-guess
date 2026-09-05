<!--
  分区标题头（可复用）：眉题（eyebrow）+ 标题（h2）的组合结构。
  收敛 Lobby/Room/Settings/弹窗等页面中大量重复的「眉题 + 标题」两行排布，
  保证全站分区标题视觉一致；纯展示组件，不含任何布局外逻辑。
-->
<script setup lang="ts">
// 只接收固定 props：杜绝 attrs 继承导致的 id/class 重复绑定（弹窗 labelledby 定位 id 由此传入）。
withDefaults(
  defineProps<{
    /** 眉题（小号英文/装饰字，如「ROOMS」「PLAYERS」） */
    eyebrow: string
    /** 标题文案（一级分区标题） */
    title: string
    /** 标题 id（弹窗 labelledby 等锚点场景使用，可选） */
    id?: string
    /** 视觉色调：default 适配浅底；light 适配深色 navy 顶栏 */
    tone?: 'default' | 'light'
  }>(),
  {
    id: undefined,
    tone: 'default',
  },
)
</script>

<template>
  <div>
    <p :class="tone === 'light' ? 'eyebrow-light' : 'eyebrow'">{{ eyebrow }}</p>
    <h2 :id="id" :class="tone === 'light' ? 'text-white' : ''">{{ title }}</h2>
  </div>
</template>
