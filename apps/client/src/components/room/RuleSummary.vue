<!--
  规则摘要 + 词库管理入口 + 邀请在线玩家按钮：原 RoomView.vue 右侧控制区的前三段。
  数据全部来自 store 的房间快照；仅通过事件把「打开词库 / 打开邀请 / 编辑规则」上抛给父组件。
  保持三块为片段（多根节点），使其仍作为 aside（flex-col）的直接子项，保留原有间距。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { BookOpenCheck, Send, Settings2 } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { roomSettingsDefaults } from '@draw-guess/config'
import type { RoomSettings } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import AppButton from '@/components/common/AppButton.vue'
import RuleRow from '@/components/room/RuleRow.vue'
import { occupiesSeatMember } from '@/utils/room-facts'

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
 * 提示规则的摘要文案：结构化提示已移除，只剩「逐步提示字符」一个开关，
 * 只按开/关两态展示，不再出现任何结构化提示组合。
 */
const hintsSummary = computed(() => {
  const settings = store.room?.settings
  if (!settings) return strings.ui.room.hintsOff
  return settings.progressiveHints ? strings.ui.room.hintsMaskOnly : strings.ui.room.hintsOff
})

function enabled(value: boolean): string {
  return value ? strings.ui.room.ruleEnabled : strings.ui.room.ruleDisabled
}

/**
 * 满员判定按**占席**口径（未离局即占席，观战者也占席），与服务端 room-membership-service 的
 * 容量校验、SeatGrid 的席位计数同口径（见 ADR-0023）；离局者为成绩卡保留的占位不算占席，
 * 否则会出现「明明还有空位却禁用邀请」的假满员。
 */
const isRoomFull = computed(() => {
  const room = store.room
  return room ? room.members.filter(occupiesSeatMember).length >= room.settings.maxPlayers : false
})

/** 非房主且房间未开放普通玩家邀请：与满员是两种不同的禁用原因，提示文案也不同。 */
const inviteForbidden = computed(
  () => !store.isHost && !(store.room?.settings.allowPlayerInvite ?? false),
)

const summaryRows = computed(() => {
  const settings = store.room?.settings
  if (!settings) return []
  // 差异基线：旧「玩法预设」已移除，改为对照 config 的唯一默认规则组，仅展示房主真正改过的项。
  const differences = new Set(
    (Object.keys(roomSettingsDefaults) as Array<keyof typeof roomSettingsDefaults>).filter(
      (field) => settings[field] !== roomSettingsDefaults[field],
    ),
  )
  const rows: Array<{ key: string; label: string; value: string }> = [
    {
      key: 'maxPlayers',
      label: strings.ui.room.ruleCapacityDt,
      value: strings.ui.common.playersUnit(settings.maxPlayers),
    },
    {
      key: 'roundsPerPlayer',
      label: strings.ui.room.ruleRoundsDt,
      value: strings.ui.room.ruleRoundsDd(settings.roundsPerPlayer),
    },
    {
      key: 'drawSeconds',
      label: strings.ui.room.ruleDrawDt,
      value: strings.ui.room.ruleDrawValue(settings.drawSeconds),
    },
  ]
  // 选词阶段是否计时是本局的关键行为（默认为不限时），常驻展示而不是按差异判定。
  rows.push({
    key: 'chooseTime',
    label: strings.ui.room.ruleChooseTimeDt,
    value: settings.allowChooseTimeLimit
      ? strings.ui.common.secondsUnit(settings.chooseSeconds)
      : strings.ui.room.chooseTimeUnlimited,
  })
  const addDifference = (
    field: keyof Omit<RoomSettings, 'maxPlayers'>,
    label: string,
    value: string,
  ): void => {
    if (differences.has(field)) rows.push({ key: field, label, value })
  }
  addDifference(
    'optionCount',
    strings.ui.room.ruleOptionsDt,
    strings.ui.room.ruleOptionsDd(settings.optionCount),
  )
  if (differences.has('progressiveHints'))
    rows.push({ key: 'hints', label: strings.ui.room.ruleHintsDt, value: hintsSummary.value })
  addDifference(
    'showWordLength',
    strings.ui.room.toggleShowWordLength,
    enabled(settings.showWordLength),
  )
  addDifference(
    'allowPlayerInvite',
    strings.ui.room.togglePlayerInvite,
    enabled(settings.allowPlayerInvite),
  )
  addDifference('allowPause', strings.ui.room.togglePause, enabled(settings.allowPause))
  addDifference(
    'allowWordReroll',
    strings.ui.room.ruleRerollDt,
    settings.allowWordReroll ? strings.ui.room.ruleRerollOn : strings.ui.room.ruleRerollOff,
  )
  addDifference(
    'allowCustomWord',
    strings.ui.room.ruleCustomWordDt,
    settings.allowCustomWord ? strings.ui.room.ruleCustomWordOn : strings.ui.room.ruleCustomWordOff,
  )
  addDifference(
    'allowNearMissHint',
    strings.ui.room.nearMissHintLabel,
    enabled(settings.allowNearMissHint),
  )
  addDifference(
    'allowCanvasReactions',
    strings.ui.room.canvasReactionsLabel,
    enabled(settings.allowCanvasReactions),
  )
  addDifference(
    'allowRoundReplay',
    strings.ui.room.roundReplayLabel,
    enabled(settings.allowRoundReplay),
  )
  addDifference(
    'joinPolicy',
    strings.ui.room.joinPolicyField,
    settings.joinPolicy === 'forbid'
      ? strings.ui.room.joinPolicyForbid
      : settings.joinPolicy === 'spectate'
        ? strings.ui.room.joinPolicySpectate
        : strings.ui.room.joinPolicyNextGame,
  )
  return rows
})
</script>

<template>
  <!-- 规则摘要：始终展示关键项，其余只展示相对默认规则组的差异。 -->
  <template v-if="store.room">
    <div>
      <div class="grid grid-cols-[1fr_auto] items-center">
        <p class="col-start-1 eyebrow">
          {{ strings.ui.room.rulesEyebrow }}
        </p>
        <h2 class="col-start-1">{{ strings.ui.room.rulesTitle }}</h2>
        <button
          type="button"
          class="col-start-2 row-[1/3] flex items-center gap-[0.4em] text-blue bg-transparent font-bold cursor-pointer"
          @click="emit('edit-rules')"
        >
          <Settings2 class="h-[1.1em] w-[1.1em]" />
          {{ store.isHost ? strings.ui.room.rulesEdit : strings.ui.room.rulesView }}
        </button>
      </div>
      <dl class="my-[1.4cqh] border-t-[0.16cqh] border-t-line">
        <RuleRow v-for="row in summaryRows" :key="row.key" :label="row.label">
          {{ row.value }}
        </RuleRow>
      </dl>
    </div>

    <!-- 词库管理入口：房主可编辑、非房主可打开查看（只读），展示已选/总词条数 -->
    <button
      class="flex items-center gap-[0.75em] min-h-[7cqh] py-[0.8cqh] px-[0.8em] text-blue bg-sky border-l-[0.45cqh] border-l-blue text-left"
      type="button"
      :disabled="props.vocabularyLoading"
      @click="emit('open-vocabulary')"
    >
      <BookOpenCheck class="h-[3.4cqh] w-[3.4cqh]" /><span class="flex-1 flex flex-col"
        ><b>{{ strings.ui.room.vocabularyTitle }}</b>
        <small class="text-muted truncate">
          <span v-if="store.room?.vocabularyPackageName" class="font-bold text-navy mr-[0.3em]"
            >[{{ store.room.vocabularyPackageName }}]</span
          >{{
            strings.ui.room.vocabularyCount(
              store.room?.selectedWordCount ?? 0,
              store.room?.totalWordCount ?? 0,
            )
          }}</small
        ></span
      ><span class="text-fs-12 font-bold">{{
        store.isHost ? strings.ui.room.vocabularyManage : strings.ui.room.vocabularyReadOnly
      }}</span>
    </button>

    <!-- 邀请在线玩家：满员或无权限时禁用 -->
    <div class="my-[1.3cqh]">
      <AppButton
        variant="secondary"
        class="w-full min-h-[4.6cqh] px-[0.5em] text-fs-12"
        :disabled="isRoomFull || inviteForbidden"
        :title="
          isRoomFull
            ? strings.ui.room.inviteDisabledFull
            : inviteForbidden
              ? strings.ui.room.inviteDisabledHostOnly
              : strings.ui.room.inviteDisabledTip
        "
        :audio-feedback="null"
        @click="emit('open-invite')"
      >
        <Send /> {{ strings.ui.room.invitePlayers }}
      </AppButton>
    </div>
  </template>
</template>
