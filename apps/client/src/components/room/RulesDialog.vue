<!--
  房间规则编辑弹窗（房主）——滑块与开关修改规则，保存前可取消。
  原 RoomView.vue 规则弹窗迁入本组件，基于 BaseDialog 复用外壳。
  父组件持有草稿（draft prop），本组件用本地副本编辑（避免修改 props），保存时把副本通过 save 上抛。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { strings } from '@draw-guess/strings'
import type { RoomSettings } from '@draw-guess/shared'
import { applyRoomPreset, matchingRoomPreset, type RoomPresetId } from '@draw-guess/config'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import SectionHeader from '@/components/common/SectionHeader.vue'
import RuleSliderField from '@/components/common/RuleSliderField.vue'
import RuleSelectField from '@/components/common/RuleSelectField.vue'
import RuleToggleField from '@/components/common/RuleToggleField.vue'
import { useGameStore } from '@/stores/game'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ draft?: RoomSettings }>()
const emit = defineEmits<{ close: []; save: [draft: RoomSettings] }>()
const store = useGameStore()

function handleClose(): void {
  open.value = false
  emit('close')
}

/** 下拉选项：数值范围/枚举值一律来自公开配置与 strings，禁止另写一套。 */
const maxPlayerOptions = computed(() =>
  Array.from(
    { length: store.config.player.maxPlayers - store.config.player.minPlayers + 1 },
    (_, index) => {
      const count = store.config.player.minPlayers + index
      return { value: count, label: strings.common.playersUnit(count) }
    },
  ),
)
const joinPolicyOptions = [
  { value: 'forbid', label: strings.room.joinPolicyForbid },
  { value: 'spectate', label: strings.room.joinPolicySpectate },
  { value: 'next_game', label: strings.room.joinPolicyNextGame },
]
const presetOptions = [
  { value: 'custom', label: strings.room.presetCustom },
  { value: 'standard', label: strings.room.presetStandard },
  { value: 'relaxed', label: strings.room.presetRelaxed },
  { value: 'speed', label: strings.room.presetSpeed },
] satisfies Array<{ value: RoomPresetId | 'custom'; label: string }>
const scoreModeOptions = [
  { value: 'standard', label: strings.room.scoreModeStandard },
  { value: 'flat', label: strings.room.scoreModeFlat },
] satisfies Array<{ value: RoomSettings['scoreMode']; label: string }>

// 本地编辑副本：所有字段均为原始值，浅拷贝即可；每次打开（draft 变化）时重新同步。
const localDraft = ref<RoomSettings>({} as RoomSettings)
const selectedPreset = ref<RoomPresetId | 'custom'>('standard')
watch(
  () => props.draft,
  (draft) => {
    if (draft) {
      localDraft.value = { ...draft }
      selectedPreset.value = matchingRoomPreset(draft) ?? 'custom'
    }
  },
  { immediate: true },
)

watch(
  localDraft,
  (draft) => {
    selectedPreset.value = matchingRoomPreset(draft) ?? 'custom'
  },
  { deep: true },
)

function selectPreset(preset: RoomPresetId | 'custom'): void {
  if (preset === 'custom') return
  selectedPreset.value = preset
  localDraft.value = applyRoomPreset(localDraft.value, preset)
}
</script>

<template>
  <!-- 规则编辑表单：数值字段用滑块，开关用复选框；中途加入策略为下拉框 -->
  <BaseDialog
    v-model:open="open"
    width-class="w-[68cqw]"
    labelledby="rules-title"
    :close-aria="strings.room.settingsCloseAria"
    @close="handleClose"
  >
    <template #header>
      <SectionHeader
        id="rules-title"
        :eyebrow="strings.room.settingsLabel"
        :title="strings.room.settingsTitle"
      ></SectionHeader>
    </template>

    <!-- 表单区在弹窗内自行滚动：低高度舞台下不会把底部操作按钮挤出可视区 -->
    <div
      class="grid min-h-0 grid-cols-2 gap-[1.5cqh_1.8em] overflow-y-auto py-[2.2cqh] px-[2em] overscroll-contain"
    >
      <RuleSelectField
        :model-value="selectedPreset"
        class="col-span-full"
        :label="strings.room.presetField"
        :options="presetOptions"
        @update:model-value="selectPreset"
      />
      <RuleSelectField
        v-model="localDraft.maxPlayers"
        :label="strings.room.maxPlayersField"
        :options="maxPlayerOptions"
      >
        <small class="text-muted text-fs-12">{{ strings.room.maxPlayersNote }}</small>
      </RuleSelectField>

      <RuleSliderField
        v-model="localDraft.roundsPerPlayer"
        :label="strings.common.roundsField"
        :min="store.config.game.roundsPerPlayer.min"
        :max="store.config.game.roundsPerPlayer.max"
        :step="store.config.game.roundsPerPlayer.step"
        :display="strings.common.roundsUnit(localDraft.roundsPerPlayer)"
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

      <RuleSelectField
        v-model="localDraft.joinPolicy"
        :label="strings.room.joinPolicyField"
        :options="joinPolicyOptions"
      />

      <div class="flex flex-col justify-center gap-[1.2cqh]">
        <RuleToggleField
          v-model="localDraft.allowPlayerInvite"
          :label="strings.room.togglePlayerInvite"
        />
        <RuleToggleField
          v-model="localDraft.allowWordReroll"
          :label="strings.room.toggleAllowWordReroll"
        />
      </div>

      <details class="col-span-full rounded-[0.7em] border-[0.16cqh] border-line bg-paper p-[1em]">
        <summary class="cursor-pointer font-bold text-blue">
          {{ strings.room.advancedSettings }}
        </summary>
        <div class="mt-[1.5cqh] grid grid-cols-3 gap-[1.5cqh_1.4em]">
          <RuleSliderField
            v-model="localDraft.drawSeconds"
            :label="strings.room.drawFallbackField"
            :min="store.config.game.drawSeconds.min"
            :max="store.config.game.drawSeconds.max"
            :step="store.config.game.drawSeconds.step"
            :display="strings.common.secondsUnit(localDraft.drawSeconds)"
            :hint="strings.room.drawFallbackHint"
          />
          <RuleSliderField
            v-model="localDraft.hintStartRatio"
            :label="strings.room.hintStartRatioField"
            :min="store.config.game.hintStartRatioRange.min"
            :max="store.config.game.hintStartRatioRange.max"
            :step="store.config.game.hintStartRatioRange.step"
            :display="strings.room.hintStartRatioUnit(localDraft.hintStartRatio)"
            :disabled="!localDraft.structuredHintsEnabled"
          />
          <RuleSliderField
            v-model="localDraft.guessBaseScore"
            :label="strings.room.guessBaseScoreField"
            :min="store.config.game.score.guessBaseRange.min"
            :max="store.config.game.score.guessBaseRange.max"
            :step="store.config.game.score.guessBaseRange.step"
            :display="strings.room.guessBaseScoreUnit(localDraft.guessBaseScore)"
          />
          <RuleSelectField
            v-model="localDraft.scoreMode"
            :label="strings.room.scoreModeField"
            :options="scoreModeOptions"
          />
          <div class="flex flex-col gap-[0.8cqh]">
            <RuleToggleField
              v-model="localDraft.showWordLength"
              :label="strings.room.toggleShowWordLength"
            />
            <RuleToggleField
              v-model="localDraft.progressiveHints"
              :label="strings.room.toggleProgressiveHints"
            />
          </div>
          <div class="flex flex-col gap-[0.8cqh]">
            <RuleToggleField
              v-model="localDraft.structuredHintsEnabled"
              :label="strings.room.toggleStructuredHints"
            />
            <RuleToggleField v-model="localDraft.allowPause" :label="strings.room.togglePause" />
          </div>
        </div>
      </details>
    </div>

    <template #footer>
      <!-- 底部操作：取消或保存规则 -->
      <p class="mr-auto text-muted text-fs-12">{{ strings.room.rulesChangeNote }}</p>
      <AppButton variant="secondary" type="button" audio-feedback="close" @click="handleClose">
        {{ strings.common.cancel }}
      </AppButton>
      <AppButton variant="primary" type="button" @click="emit('save', localDraft)">
        {{ strings.room.saveRules }}
      </AppButton>
    </template>
  </BaseDialog>
</template>
