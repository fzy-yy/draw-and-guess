<!--
  接龙左栏的状态行（S41 / S64，经 PlayerPanel 的 `status` 插槽挂载）：
  动手期＝「已提交 / 未提交」、投票期＝「已投票 / 未投票」，只表达个体状态、不显示数目。
  数据全部来自接龙快照派生（`submittedPlayerIds`），成员状态零新增字段；
  复盘展示与终局不表达状态（改由分数与结算版式说话）。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { CheckCheck, Vote } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'

const props = defineProps<{
  /** 该玩家在本步（或本条链）是否已动作。 */
  submitted: boolean
  /** 本阶段收集的是提交还是投票。 */
  mode: 'submit' | 'vote'
}>()

const label = computed(() => {
  if (props.mode === 'vote')
    return props.submitted ? strings.ui.game.relayVoted : strings.ui.game.relayNotVoted
  return props.submitted ? strings.ui.game.relaySubmitted : strings.ui.game.relayNotSubmitted
})
</script>

<template>
  <span
    class="flex shrink-0 items-center gap-[0.25em] truncate text-fs-10 font-bold"
    :class="props.submitted ? 'text-success-fg' : 'text-muted'"
  >
    <CheckCheck v-if="props.submitted" class="h-[1.6cqh] w-[1.6cqh]" aria-hidden="true" />
    <Vote v-else-if="props.mode === 'vote'" class="h-[1.6cqh] w-[1.6cqh]" aria-hidden="true" />
    {{ label }}
  </span>
</template>
