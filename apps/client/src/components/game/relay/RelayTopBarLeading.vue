<!--
  接龙顶栏左栏内容（S74 / S75，经 GameHud 的 `leading` 插槽挂载）：
  模式标签 + 阶段短名 + 「第 N 棒 / 共 4 棒」胶囊（动手期）或「第 k / N 条链」胶囊（复盘期）。
  棒次胶囊复用经典 ROUND 胶囊的样式与位置（前缀小字 / 大号数字 / 总数小字）；
  复盘进度**紧跟在最左标签之后**（S75），不再单独占一个语义位置（对局期不出现，两者互斥）。
  还没进接龙阶段的开局倒计时期（服务端该期不下发接龙视图，S22）由 `phase` 缺省表达：
  此时只出模式标签 + 房间阶段名，不挂棒次胶囊。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { RELAY_STEP_COUNT, type RelayViewPhase } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import HudPill from '@/components/game/HudPill.vue'
import { phaseTextFor, relayPillTextFor } from '@/utils/phase-text'

const props = defineProps<{
  /**
   * 接龙视图阶段（顶栏左栏据此渲染阶段名）。可选＝接龙房**还没进入接龙阶段**的时刻
   * （开局倒计时 `starting` 期服务端不下发 relay 视图，S22）——那时按房间阶段展示阶段名，
   * 顶栏因此不会退回经典 ROUND 胶囊（阶段文案仍由 `utils/phase-text` 单一口径给出）。
   */
  phase?: RelayViewPhase
  /** 当前棒次（1–4）。 */
  step: number
  /** 复盘链进度（第 k / N 条链）：非复盘期不下发，故为空即不渲染。 */
  chainProgress?: { index: number; total: number }
}>()

const store = useGameStore()

/** 阶段文本：进了接龙阶段用接龙短名；还没进（开局倒计时）时按房间阶段展示。 */
const phaseText = computed(() =>
  props.phase ? relayPillTextFor(props.phase) : phaseTextFor(store.room?.phase),
)

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
    <b
      class="text-white text-fs-16 leading-none inline-block w-[4em] text-center whitespace-nowrap"
    >
      {{ phaseText }}
    </b>
  </HudPill>
  <!-- 复盘链条进度：紧跟最左标签之后（S75），与棒次胶囊互斥 -->
  <HudPill v-if="props.chainProgress" class="shrink-0">
    <span class="text-sky text-fs-12 tabular-nums">{{
      strings.ui.game.relayChainProgress(props.chainProgress.index, props.chainProgress.total)
    }}</span>
  </HudPill>
  <HudPill v-if="showsStep" class="shrink-0">
    <span class="text-sky text-fs-12">{{ strings.ui.game.relayStepPrefix }}</span>
    <b class="text-white text-fs-24 leading-none tabular-nums">{{ props.step }}</b>
    <small class="text-sky text-fs-10">{{
      strings.ui.game.relayStepTotal(RELAY_STEP_COUNT)
    }}</small>
  </HudPill>
</template>
