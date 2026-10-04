<!--
  接龙顶栏左栏内容（S74 / S75，经 GameHud 的 `leading` 插槽挂载）：
  模式标签 + 阶段短名 + 「第 N 棒 / 共 4 棒」胶囊。
  棒次胶囊复用经典 ROUND 胶囊的样式与位置（前缀小字 / 大号数字 / 总数小字），
  复盘期与终局不出棒次（进度表达归复盘链条进度，工单 11），只保留模式与阶段。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { RELAY_STEP_COUNT, type RelayViewPhase } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import HudPill from '@/components/game/HudPill.vue'
import { relayPillTextFor } from '@/utils/phase-text'

const props = defineProps<{
  /** 接龙视图阶段（顶栏左栏据此渲染阶段名）。 */
  phase: RelayViewPhase
  /** 当前棒次（1–4）。 */
  step: number
}>()

/** 棒次胶囊只在动手期（选词 / 作画 / 猜词）出现。 */
const showsStep = computed(
  () =>
    props.phase === 'relay_choose' || props.phase === 'relay_draw' || props.phase === 'relay_guess',
)
</script>

<template>
  <!-- 模式标签复用房间头同一份模式文案（ui.room.modeRelay）：两处都是「这一局玩什么」，同一个词 -->
  <HudPill class="shrink-0">
    <span class="text-sky text-fs-12">{{ strings.ui.room.modeRelay }}</span>
    <b class="text-white text-fs-16 leading-none">{{ relayPillTextFor(props.phase) }}</b>
  </HudPill>
  <HudPill v-if="showsStep" class="shrink-0">
    <span class="text-sky text-fs-12">{{ strings.ui.game.relayStepPrefix }}</span>
    <b class="text-white text-fs-24 leading-none tabular-nums">{{ props.step }}</b>
    <small class="text-sky text-fs-10">{{
      strings.ui.game.relayStepTotal(RELAY_STEP_COUNT)
    }}</small>
  </HudPill>
</template>
