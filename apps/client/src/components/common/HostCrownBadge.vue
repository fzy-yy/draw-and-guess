<!--
  房主皇冠徽章（可复用）：黄色皇冠 + 淡色圆形衬底。
  为什么需要衬底：皇冠本身为黄色，直接叠在白色卡片或彩色席位行上时
  对比度不足、甚至被同色背景吞掉（曾出现黄底黄字导致图标“消失”）；
  淡黄色圆形衬底让图标在任何底色上都稳定突出。
  使用场景：房间席位网格（悬浮在头像右上角）、对局玩家得分条（行尾标记）。
  尺寸由调用处通过 class 传入（如 h-[3.2cqh] w-[3.2cqh]），组件内部只负责结构。
-->
<script setup lang="ts">
import { Crown } from 'lucide-vue-next'

defineProps<{
  /** 无障碍标签（如「房主」）；不传则不渲染 aria-label。 */
  label?: string
}>()
</script>

<template>
  <span
    class="grid place-items-center rounded-full bg-yellow/25 p-[0.3cqh]"
    :aria-label="label"
    role="img"
  >
    <Crown class="h-[70%] w-[70%] fill-yellow text-yellow" aria-hidden="true" />
  </span>
</template>
