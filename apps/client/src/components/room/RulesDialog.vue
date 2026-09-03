<!--
  房间规则编辑弹窗（房主）——滑块与开关修改规则，保存前可取消。
  原 RoomView.vue 规则弹窗迁入本组件，基于 BaseDialog 复用外壳。
  父组件持有草稿（draft prop），本组件用本地副本编辑（避免修改 props），保存时把副本通过 save 上抛。
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { strings } from '@draw-guess/strings'
import type { RoomSettings } from '@draw-guess/shared'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import SectionHeader from '@/components/common/SectionHeader.vue'
import RuleSliderField from '@/components/common/RuleSliderField.vue'
import RuleToggleField from '@/components/common/RuleToggleField.vue'
import { useGameStore } from '@/stores/game'

const props = defineProps<{ open: boolean; draft?: RoomSettings }>()
const emit = defineEmits<{ close: []; save: [draft: RoomSettings] }>()
const store = useGameStore()

// 本地编辑副本：所有字段均为原始值，浅拷贝即可；每次打开（draft 变化）时重新同步。
const localDraft = ref<RoomSettings>({} as RoomSettings)
watch(
  () => props.draft,
  (draft) => {
    if (draft) localDraft.value = { ...draft }
  },
  { immediate: true },
)
</script>

<template>
  <!-- 规则编辑表单：数值字段用滑块，开关用复选框；中途加入策略为下拉框 -->
  <BaseDialog
    :open="props.open"
    width-class="w-[70cqw]"
    labelledby="rules-title"
    :close-aria="strings.room.settingsCloseAria"
    @close="emit('close')"
  >
    <template #header>
      <SectionHeader
        id="rules-title"
        :eyebrow="strings.room.settingsLabel"
        :title="strings.room.settingsTitle"
      ></SectionHeader>
    </template>

    <div class="grid grid-cols-3 gap-[1.2cqh_1.3em] py-[2cqh] px-[1.8em]">
      <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
        >{{ strings.room.maxPlayersField }}
        <select
          v-model="localDraft.maxPlayers"
          class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-navy"
        >
          <option
            v-for="n in store.config.player.maxPlayers - store.config.player.minPlayers + 1"
            :key="n"
            :value="store.config.player.minPlayers + n - 1"
          >
            {{ strings.common.playersUnit(store.config.player.minPlayers + n - 1) }}
          </option></select
        ><small class="text-muted text-[0.8em]">{{ strings.room.maxPlayersNote }}</small></label
      >
      <RuleSliderField
        v-model="localDraft.roundsPerPlayer"
        :label="strings.common.roundsField"
        :min="store.config.game.roundsPerPlayer.min"
        :max="store.config.game.roundsPerPlayer.max"
        :step="store.config.game.roundsPerPlayer.step"
        :display="strings.common.roundsUnit(localDraft.roundsPerPlayer)"
      />
      <RuleSliderField
        v-model="localDraft.drawSeconds"
        :label="strings.common.drawTimeField"
        :min="store.config.game.drawSeconds.min"
        :max="store.config.game.drawSeconds.max"
        :step="store.config.game.drawSeconds.step"
        :display="strings.common.secondsUnit(localDraft.drawSeconds)"
      />
      <RuleSliderField
        v-model="localDraft.chooseSeconds"
        :label="strings.room.chooseTimeField"
        :min="store.config.game.chooseSeconds.min"
        :max="store.config.game.chooseSeconds.max"
        :step="store.config.game.chooseSeconds.step"
        :display="strings.common.secondsUnit(localDraft.chooseSeconds)"
      />
      <RuleSliderField
        v-model="localDraft.optionCount"
        :label="strings.room.optionCountField"
        :min="store.config.game.optionCount.min"
        :max="store.config.game.optionCount.max"
        :step="store.config.game.optionCount.step"
        :display="strings.room.optionCountUnit(localDraft.optionCount)"
      />
      <RuleToggleField
        v-model="localDraft.showWordLength"
        :label="strings.room.toggleShowWordLength"
      />
      <RuleToggleField
        v-model="localDraft.progressiveHints"
        :label="strings.room.toggleProgressiveHints"
      />
      <RuleToggleField
        v-model="localDraft.structuredHintsEnabled"
        :label="strings.room.toggleStructuredHints"
      />
      <!-- 结构化提示开始时机：剩余时间比例（10%~90%，步进 5%） -->
      <RuleSliderField
        v-model="localDraft.hintStartRatio"
        :label="strings.room.hintStartRatioField"
        :min="store.config.game.hintStartRatioRange.min"
        :max="store.config.game.hintStartRatioRange.max"
        :step="store.config.game.hintStartRatioRange.step"
        :display="strings.common.percentUnit(Math.round(localDraft.hintStartRatio * 100))"
        :disabled="!localDraft.structuredHintsEnabled"
      />
      <!-- 提示间隔：相邻提示揭示时机之间的剩余比例（5%~45%，步进 5%） -->
      <RuleSliderField
        v-model="localDraft.hintIntervalRatio"
        :label="strings.room.hintIntervalRatioField"
        :min="store.config.game.hintIntervalRatioRange.min"
        :max="store.config.game.hintIntervalRatioRange.max"
        :step="store.config.game.hintIntervalRatioRange.step"
        :display="strings.common.percentUnit(Math.round(localDraft.hintIntervalRatio * 100))"
        :disabled="!localDraft.structuredHintsEnabled"
      />
      <!-- 统一猜词基础分：覆盖全局默认值（flat 模式下即为唯一得分） -->
      <RuleSliderField
        v-model="localDraft.guessBaseScore"
        :label="strings.room.guessBaseScoreField"
        :min="store.config.game.score.guessBaseRange.min"
        :max="store.config.game.score.guessBaseRange.max"
        :step="store.config.game.score.guessBaseRange.step"
        :display="strings.room.guessBaseScoreUnit(localDraft.guessBaseScore)"
      />
      <!-- 计分方式：标准（基础+速度+顺序）/ 固定分（仅基础分） -->
      <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
        >{{ strings.room.scoreModeField }}
        <select
          v-model="localDraft.scoreMode"
          class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-navy"
        >
          <option value="standard">{{ strings.room.scoreModeStandard }}</option>
          <option value="flat">{{ strings.room.scoreModeFlat }}</option>
        </select></label
      >
      <RuleToggleField
        v-model="localDraft.closeGuessEnabled"
        :label="strings.room.toggleCloseGuess"
      />
      <RuleToggleField
        v-model="localDraft.allowPlayerInvite"
        :label="strings.room.togglePlayerInvite"
      />
      <RuleToggleField v-model="localDraft.allowPause" :label="strings.room.togglePause" />
      <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
        >{{ strings.room.joinPolicyField }}
        <select
          v-model="localDraft.joinPolicy"
          class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-navy"
        >
          <option value="forbid">{{ strings.room.joinPolicyForbid }}</option>
          <option value="spectate">{{ strings.room.joinPolicySpectate }}</option>
          <option value="next_game">{{ strings.room.joinPolicyNextGame }}</option>
        </select></label
      >
    </div>

    <template #footer>
      <!-- 底部操作：取消或保存规则 -->
      <p class="mr-auto text-muted text-[0.72em]">{{ strings.room.rulesChangeNote }}</p>
      <AppButton variant="secondary" type="button" @click="emit('close')">
        {{ strings.common.cancel }}
      </AppButton>
      <AppButton variant="primary" type="button" @click="emit('save', localDraft)">
        {{ strings.room.saveRules }}
      </AppButton>
    </template>
  </BaseDialog>
</template>
