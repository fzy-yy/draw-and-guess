<!--
  阶段遮罩卡片：收敛 PhaseOverlay 中 4 个重复的「遮罩 + 居中卡片」长串。
  wide 用于需要更宽卡片的场景（最终结算）。内容经默认插槽传入。
-->
<script setup lang="ts">
const props = withDefaults(defineProps<{ wide?: boolean }>(), { wide: false })
</script>

<template>
  <div class="absolute inset-0 z-30 grid place-items-center bg-navy/80 px-[5cqw] py-[4cqh]">
    <section
      class="flex flex-col items-center gap-[1.2cqh] rounded-[1.2em] border-[0.35cqh] border-white bg-paper px-[4cqw] py-[4cqh] text-center"
      :class="props.wide ? 'min-w-[55cqw]' : 'min-w-[50cqw]'"
    >
      <slot />
    </section>
  </div>
</template>
