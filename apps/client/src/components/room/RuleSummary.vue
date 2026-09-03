<!--
  规则摘要 + 词库管理入口 + 邀请在线玩家按钮：原 RoomView.vue 右侧控制区的前三段。
  数据全部来自 store 的房间快照；仅通过事件把「打开词库 / 打开邀请 / 编辑规则」上抛给父组件。
  保持三块为片段（多根节点），使其仍作为 aside（flex-col）的直接子项，保留原有间距。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { BookOpenCheck, Send, Settings2 } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import RuleRow from '@/components/room/RuleRow.vue'

const props = defineProps<{
  /** 词库拉取中：房主按钮应禁用，避免重复请求 */
  vocabularyLoading: boolean
}>()

const emit = defineEmits<{
  'open-vocabulary': []
  'open-invite': []
  'edit-rules': []
}>()

const store = useGameStore()

/**
 * 提示规则的摘要文案：逐字遮罩与结构化提示是两个独立开关，
 * 按「双开 / 仅结构化 / 仅逐字 / 全关」四种组合展示，避免两个开关挤在一行。
 */
const hintsSummary = computed(() => {
  const settings = store.room?.settings
  if (!settings) return strings.room.hintsOff
  if (settings.progressiveHints && settings.structuredHintsEnabled) return strings.room.hintsBothOn
  if (settings.structuredHintsEnabled) return strings.room.hintsStructuredOnly
  if (settings.progressiveHints) return strings.room.hintsMaskOnly
  return strings.room.hintsOff
})
</script>

<template>
  <!-- 规则摘要：作画轮数 / 时间 / 候选词 / 提示 -->
  <template v-if="store.room">
    <div>
      <div class="grid grid-cols-[1fr_auto] items-center">
        <p class="col-start-1 eyebrow">
          {{ strings.room.rulesEyebrow }}
        </p>
        <h2 class="col-start-1">{{ strings.room.rulesTitle }}</h2>
        <button
          v-if="store.isHost"
          type="button"
          class="col-start-2 row-[1/3] flex items-center gap-[0.4em] text-blue bg-transparent font-extrabold"
          @click="emit('edit-rules')"
        >
          <Settings2 /> {{ strings.room.rulesEdit }}
        </button>
      </div>
      <dl class="my-[1.4cqh] border-t-[0.16cqh] border-t-line">
        <RuleRow :label="strings.room.ruleRoundsDt">
          {{ strings.room.ruleRoundsDd(store.room?.settings.roundsPerPlayer ?? 0) }}
        </RuleRow>
        <RuleRow :label="strings.room.ruleDrawDt">
          {{ strings.room.ruleDrawDd(store.room?.settings.drawSeconds ?? 0) }}
        </RuleRow>
        <RuleRow :label="strings.room.ruleOptionsDt">
          {{ strings.room.ruleOptionsDd(store.room?.settings.optionCount ?? 0) }}
        </RuleRow>
        <RuleRow :label="strings.room.ruleHintsDt">
          {{ hintsSummary }}
        </RuleRow>
      </dl>
    </div>

    <!-- 词库管理入口：仅房主可编辑，展示已选/总词条数 -->
    <button
      class="flex items-center gap-[0.75em] min-h-[7cqh] py-[0.8cqh] px-[0.8em] text-blue bg-sky border-l-[0.45cqh]! border-l-blue! text-left"
      type="button"
      :disabled="!store.isHost || props.vocabularyLoading"
      @click="emit('open-vocabulary')"
    >
      <BookOpenCheck class="h-[3.4cqh] w-[3.4cqh]" /><span class="flex-1 flex flex-col"
        ><b>{{ strings.room.vocabularyTitle }}</b
        ><small class="text-muted">{{
          strings.room.vocabularyCount(
            store.room?.selectedWordCount ?? 0,
            store.room?.totalWordCount ?? 0,
          )
        }}</small></span
      ><span class="text-[0.68em] font-extrabold">{{
        store.isHost ? strings.room.vocabularyManage : strings.room.vocabularyHostOnly
      }}</span>
    </button>

    <!-- 邀请在线玩家：满员或无权限时禁用 -->
    <div class="grid grid-cols-1 gap-[0.6em] my-[1.3cqh]">
      <button
        class="inline-flex min-h-[4.6cqh] items-center justify-center gap-[0.65em] rounded-[0.7em] px-[0.5em] font-black text-navy bg-white border-[0.18cqh]! border-line! text-[0.72em]"
        type="button"
        :disabled="
          (store.room?.members.length ?? 0) >= (store.room?.settings.maxPlayers ?? 0) ||
          (!store.isHost && !(store.room?.settings.allowPlayerInvite ?? false))
        "
        :title="
          (store.room?.members.length ?? 0) >= (store.room?.settings.maxPlayers ?? 0)
            ? strings.room.inviteDisabledFull
            : !store.isHost && !(store.room?.settings.allowPlayerInvite ?? false)
              ? strings.room.inviteDisabledHostOnly
              : strings.room.inviteDisabledTip
        "
        @click="emit('open-invite')"
      >
        <Send /> {{ strings.room.invitePlayers }}
      </button>
    </div>
  </template>
</template>
