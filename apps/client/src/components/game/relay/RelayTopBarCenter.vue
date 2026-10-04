<!--
  接龙顶栏正中的答案 UI（S74，经 GameHud 的 `center` 插槽挂载）：
  对局期**只有一处答案**，左侧按条件挂上一家 chip——
  步 1（自己选的词）没有上一家 → 不渲染 chip；步 2/4（看上一家的画猜词）带画笔角标；
  步 3（按上一家的词作画）不带角标（他没画东西给我，角标语义见 S73）。
  猜词棒的题面是提示语（配眼睛图标、冷色），作画棒是要画的词（高亮黄色），与经典题目胶囊同一视觉语言。
  复盘期的四元组（画家 chip + 答案 A → 答案 B + 猜词者 chip）由工单 11 接入同一插槽。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Eye } from 'lucide-vue-next'
import type { RelayPlayerRef } from '@draw-guess/shared'
import HudPill from '@/components/game/HudPill.vue'
import RelayPlayerChip from '@/components/game/RelayPlayerChip.vue'

const props = defineProps<{
  /** 本棒题面文本（源自 useGameHud 的接龙派生）。 */
  prompt: string
  /** 题面形态：question＝看图猜词的提示语；text＝真正要画的词。 */
  promptKind: 'question' | 'text'
  /** 上一家（步 1 不下发，故为空即不渲染 chip）。 */
  artist?: RelayPlayerRef
  /** 上一家是否带画笔角标（步 2/4 带、步 3 不带）。 */
  artistPaints: boolean
}>()

const isQuestion = computed(() => props.promptKind === 'question')
</script>

<template>
  <div class="flex min-w-0 items-center gap-[0.6cqw]">
    <RelayPlayerChip v-if="props.artist" :player="props.artist" :brush-badge="props.artistPaints" />
    <HudPill
      class="min-w-[16cqw] max-w-[34cqw] justify-center px-[1.2em]"
      :class="isQuestion ? 'bg-white/10' : ''"
    >
      <b
        class="flex items-center gap-[0.4em] text-fs-24 tracking-[0.16em]"
        :class="isQuestion ? 'text-sky' : 'text-yellow'"
      >
        <Eye v-if="isQuestion" class="h-[3cqh] w-[3cqh]" aria-hidden="true" />
        {{ props.prompt }}
      </b>
    </HudPill>
  </div>
</template>
