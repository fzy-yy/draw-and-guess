<!--
  房间规则编辑弹窗（房主）——滑块与开关修改规则，保存前可取消。
  原 RoomView.vue 规则弹窗迁入本组件，基于 BaseDialog 复用外壳。
  父组件持有草稿（draft prop），本组件用本地副本编辑（避免修改 props），保存时把副本通过 save 上抛。
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { strings } from '@draw-guess/strings'
import type { RoomSettings } from '@draw-guess/shared'
import BaseDialog from '@/components/BaseDialog.vue'
import AppButton from '@/components/AppButton.vue'
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
      <p class="text-blue font-black tracking-[0.16em] text-[0.72em]">
        {{ strings.room.settingsLabel }}
      </p>
      <h2 id="rules-title">{{ strings.room.settingsTitle }}</h2>
    </template>

    <div class="grid grid-cols-3 gap-[1.2cqh_1.3em] py-[2cqh] px-[1.8em]">
      <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
        >{{ strings.room.maxPlayersField }}
        <select
          v-model="localDraft.maxPlayers"
          class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-ink"
        >
          <option v-for="value in 5" :key="value" :value="value + 1">
            {{ strings.common.playersUnit(value + 1) }}
          </option></select
        ><small class="text-muted text-[0.8em]">{{ strings.room.maxPlayersNote }}</small></label
      >
      <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
        >{{ strings.common.roundsField }}
        <input
          v-model.number="localDraft.roundsPerPlayer"
          type="range"
          :min="store.config.game.roundsPerPlayer.min"
          :max="store.config.game.roundsPerPlayer.max"
          :step="store.config.game.roundsPerPlayer.step"
        /><b class="text-blue">{{
          strings.common.roundsUnit(localDraft.roundsPerPlayer)
        }}</b></label
      >
      <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
        >{{ strings.common.drawTimeField }}
        <input
          v-model.number="localDraft.drawSeconds"
          type="range"
          :min="store.config.game.drawSeconds.min"
          :max="store.config.game.drawSeconds.max"
          :step="store.config.game.drawSeconds.step"
        /><b class="text-blue">{{ strings.common.secondsUnit(localDraft.drawSeconds) }}</b></label
      >
      <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
        >{{ strings.room.chooseTimeField }}
        <input
          v-model.number="localDraft.chooseSeconds"
          type="range"
          :min="store.config.game.chooseSeconds.min"
          :max="store.config.game.chooseSeconds.max"
          :step="store.config.game.chooseSeconds.step"
        /><b class="text-blue">{{ strings.common.secondsUnit(localDraft.chooseSeconds) }}</b></label
      >
      <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
        >{{ strings.room.optionCountField }}
        <input
          v-model.number="localDraft.optionCount"
          type="range"
          :min="store.config.game.optionCount.min"
          :max="store.config.game.optionCount.max"
          :step="store.config.game.optionCount.step"
        /><b class="text-blue">{{ strings.room.optionCountUnit(localDraft.optionCount) }}</b></label
      >
      <label
        class="min-w-0 flex flex-row items-center gap-[0.5cqh] min-h-[4.8cqh] px-[0.8em] text-[0.76em] font-extrabold bg-slate-200 rounded-[0.5em]"
        ><input
          v-model="localDraft.showWordLength"
          type="checkbox"
          class="h-[2.2cqh] w-[2.2cqh] accent-blue"
        />
        {{ strings.room.toggleShowWordLength }}</label
      >
      <label
        class="min-w-0 flex flex-row items-center gap-[0.5cqh] min-h-[4.8cqh] px-[0.8em] text-[0.76em] font-extrabold bg-slate-200 rounded-[0.5em]"
        ><input
          v-model="localDraft.progressiveHints"
          type="checkbox"
          class="h-[2.2cqh] w-[2.2cqh] accent-blue"
        />
        {{ strings.room.toggleProgressiveHints }}</label
      >
      <label
        class="min-w-0 flex flex-row items-center gap-[0.5cqh] min-h-[4.8cqh] px-[0.8em] text-[0.76em] font-extrabold bg-slate-200 rounded-[0.5em]"
        ><input
          v-model="localDraft.structuredHintsEnabled"
          type="checkbox"
          class="h-[2.2cqh] w-[2.2cqh] accent-blue"
        />
        {{ strings.room.toggleStructuredHints }}</label
      >
      <!-- 结构化提示开始时机：剩余时间比例（10%~90%，步进 5%） -->
      <label
        class="min-w-0 flex flex-col gap-[0.3cqh] text-[0.76em] font-extrabold"
        :class="{ 'opacity-45 pointer-events-none': !localDraft.structuredHintsEnabled }"
        >{{ strings.room.hintStartRatioField }}
        <input
          v-model.number="localDraft.hintStartRatio"
          type="range"
          :min="0.1"
          :max="0.9"
          :step="0.05"
          :disabled="!localDraft.structuredHintsEnabled"
        /><b class="text-blue">{{
          strings.room.hintStartRatioUnit(Math.round(localDraft.hintStartRatio * 100))
        }}</b></label
      >
      <!-- 提示间隔：相邻提示揭示时机之间的剩余比例（5%~45%，步进 5%） -->
      <label
        class="min-w-0 flex flex-col gap-[0.3cqh] text-[0.76em] font-extrabold"
        :class="{ 'opacity-45 pointer-events-none': !localDraft.structuredHintsEnabled }"
        >{{ strings.room.hintIntervalRatioField }}
        <input
          v-model.number="localDraft.hintIntervalRatio"
          type="range"
          :min="0.05"
          :max="0.45"
          :step="0.05"
          :disabled="!localDraft.structuredHintsEnabled"
        /><b class="text-blue">{{
          strings.room.hintIntervalRatioUnit(Math.round(localDraft.hintIntervalRatio * 100))
        }}</b></label
      >
      <!-- 统一猜词基础分：覆盖全局默认值（flat 模式下即为唯一得分） -->
      <label class="min-w-0 flex flex-col gap-[0.3cqh] text-[0.76em] font-extrabold"
        >{{ strings.room.guessBaseScoreField }}
        <input
          v-model.number="localDraft.guessBaseScore"
          type="range"
          :min="50"
          :max="2000"
          :step="50"
        /><b class="text-blue">{{
          strings.room.guessBaseScoreUnit(localDraft.guessBaseScore)
        }}</b></label
      >
      <!-- 计分方式：标准（基础+速度+顺序）/ 固定分（仅基础分） -->
      <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
        >{{ strings.room.scoreModeField }}
        <select
          v-model="localDraft.scoreMode"
          class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-ink"
        >
          <option value="standard">{{ strings.room.scoreModeStandard }}</option>
          <option value="flat">{{ strings.room.scoreModeFlat }}</option>
        </select></label
      >
      <label
        class="min-w-0 flex flex-row items-center gap-[0.5cqh] min-h-[4.8cqh] px-[0.8em] text-[0.76em] font-extrabold bg-slate-200 rounded-[0.5em]"
        ><input
          v-model="localDraft.closeGuessEnabled"
          type="checkbox"
          class="h-[2.2cqh] w-[2.2cqh] accent-blue"
        />
        {{ strings.room.toggleCloseGuess }}</label
      >
      <label
        class="min-w-0 flex flex-row items-center gap-[0.5cqh] min-h-[4.8cqh] px-[0.8em] text-[0.76em] font-extrabold bg-slate-200 rounded-[0.5em]"
        ><input
          v-model="localDraft.allowPlayerInvite"
          type="checkbox"
          class="h-[2.2cqh] w-[2.2cqh] accent-blue"
        />
        {{ strings.room.togglePlayerInvite }}</label
      >
      <label
        class="min-w-0 flex flex-row items-center gap-[0.5cqh] min-h-[4.8cqh] px-[0.8em] text-[0.76em] font-extrabold bg-slate-200 rounded-[0.5em]"
        ><input
          v-model="localDraft.allowPause"
          type="checkbox"
          class="h-[2.2cqh] w-[2.2cqh] accent-blue"
        />
        {{ strings.room.togglePause }}</label
      >
      <label class="min-w-0 flex flex-col gap-[0.5cqh] text-[0.76em] font-extrabold"
        >{{ strings.room.joinPolicyField }}
        <select
          v-model="localDraft.joinPolicy"
          class="min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-ink"
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
