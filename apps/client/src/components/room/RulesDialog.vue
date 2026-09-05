<!--
  房间规则编辑弹窗（房主）——滑块与开关修改规则，保存前可取消。
  原 RoomView.vue 规则弹窗迁入本组件，基于 BaseDialog 复用外壳。
  父组件持有草稿（draft prop），本组件用本地副本编辑（避免修改 props），保存时把副本通过 save 上抛。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { strings } from '@draw-guess/strings'
import type { RoomSettings } from '@draw-guess/shared'
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
    v-model:open="open"
    width-class="w-[56cqw]"
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

    <div class="grid grid-cols-2 gap-[1.5cqh_1.8em] py-[2.2cqh] px-[2em]">
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
    </div>

    <template #footer>
      <!-- 底部操作：取消或保存规则 -->
      <p class="mr-auto text-muted text-fs-12">{{ strings.room.rulesChangeNote }}</p>
      <AppButton variant="secondary" type="button" @click="handleClose">
        {{ strings.common.cancel }}
      </AppButton>
      <AppButton variant="primary" type="button" @click="emit('save', localDraft)">
        {{ strings.room.saveRules }}
      </AppButton>
    </template>
  </BaseDialog>
</template>
