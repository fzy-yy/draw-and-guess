<!--
  对局 HUD 胶囊底衬：与顶栏计时器一致的淡白色圆角底（bg-white/10），
  统一回合计数、当前画家、计时器等信息块的视觉语言；内容经默认插槽传入。
  紧急高亮等附加状态类（如 !bg-red）由调用处经 class 透传（单根组件自动合并）。
-->
<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { cn } from '@/utils/cn'

const attrs = useAttrs()
const rootClass = computed(() =>
  cn(
    'flex h-[6.5cqh] min-w-0 items-center gap-[0.45em] rounded-[0.65em] bg-white/10 px-[0.7em] whitespace-nowrap',
    attrs.class,
  ),
)
</script>

<template>
  <div :class="rootClass">
    <slot />
  </div>
</template>
