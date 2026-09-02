<!--
  规则摘要行：收敛 RuleSummary 中 4 个重复的 dt/dd 行（作画次数/作画时间/候选词/提示）。
  仅承载一行“标签 + 值”的水平排布；值经默认插槽传入（支持富内容）。
-->
<script setup lang="ts">
const props = defineProps<{ label: string }>()
</script>

<template>
  <div class="flex justify-between py-[0.85cqh] border-b-[0.14cqh] border-b-line text-[0.75em]">
    <dt class="text-muted">{{ props.label }}</dt>
    <dd class="m-0 font-black"><slot /></dd>
  </div>
</template>
