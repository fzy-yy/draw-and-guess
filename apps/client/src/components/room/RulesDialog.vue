<!--
  房间规则编辑弹窗（房主）——滑块与开关修改规则，保存前可取消。
  原 RoomView.vue 规则弹窗迁入本组件，基于 BaseDialog 复用外壳。
  父组件持有草稿（draft prop），本组件用本地副本编辑（避免修改 props），保存时把副本通过 save 上抛。

  布局约定：
  - 卡片固定高度（h-[82cqh]）+ 表单区 flex-1 滚动：展开/收起收纳卡时弹窗大小不变，
    内容超高由表单区滚动条容纳（旧「展开把弹窗撑大」缺陷的修复点）；
  - 规则分「基础设置 / 高级设置」两个可收纳 <details>，基础默认展开；
  - 旧「玩法预设」与「计分方式」下拉已移除：预设取消（唯一默认组见 config roomSettingsDefaults），
    计分固定为标准（基础+速度+顺序）。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { strings } from '@draw-guess/strings'
import type { RoomSettings } from '@draw-guess/shared'
import { defaultRoomSettings } from '@draw-guess/config'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import SectionHeader from '@/components/common/SectionHeader.vue'
import RuleSliderField from '@/components/common/RuleSliderField.vue'
import RuleSelectField, { type RuleSelectOption } from '@/components/common/RuleSelectField.vue'
import RuleToggleField from '@/components/common/RuleToggleField.vue'
import { useGameStore } from '@/stores/game'
import { playerCountOptions } from '@/utils/room-facts'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ draft?: RoomSettings }>()
const emit = defineEmits<{ save: [draft: RoomSettings] }>()
const store = useGameStore()

/** 关闭弹窗：只写 v-model:open（BaseDialog 自身的关闭路径也会写回 false，不再向上抛 close）。 */
function handleClose(): void {
  open.value = false
}

/** 下拉选项：数值范围/枚举值一律来自公开配置与 strings，禁止另写一套。 */
const maxPlayerOptions = computed(() =>
  playerCountOptions({
    min: store.config.player.minPlayers,
    max: store.config.player.maxPlayers,
  }),
)
// 显式标注选项值类型为协议联合：不加标注时 value 会被拓宽为 string，
// RuleSelectField 的 v-model 与 options 泛型配对即失效（strictTemplates 试点抓出的真实缺陷）。
const joinPolicyOptions: RuleSelectOption<RoomSettings['joinPolicy']>[] = [
  { value: 'forbid', label: strings.ui.room.joinPolicyForbid },
  { value: 'spectate', label: strings.ui.room.joinPolicySpectate },
  { value: 'next_game', label: strings.ui.room.joinPolicyNextGame },
]
/**
 * 单回合时长档位：合法值来自公开配置（唯一来源是协议常量），
 * 展示文案由 strings 统一格式化；不使用原生 <select>。
 */
const drawSecondsOptions: RuleSelectOption<RoomSettings['drawSeconds']>[] =
  store.config.game.drawSeconds.options.map((seconds) => ({
    value: seconds,
    label: strings.ui.common.secondsUnit(seconds),
  }))

// 本地编辑副本：所有字段均为原始值，浅拷贝即可；每次打开（draft 变化）时重新同步。
// 初值用配置工厂生成完整合法对象，避免用类型断言绕过 RoomSettings 的字段约束。
const localDraft = ref<RoomSettings>(defaultRoomSettings(store.config.player.maxPlayers))
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
    width-class="w-[68cqw]"
    section-class="h-[82cqh]"
    labelledby="rules-title"
    :close-aria="strings.a11y.room.settingsCloseAria"
  >
    <template #header>
      <SectionHeader
        id="rules-title"
        :eyebrow="strings.ui.room.settingsLabel"
        :title="strings.ui.room.settingsTitle"
      ></SectionHeader>
    </template>

    <!-- 表单区在弹窗内自行滚动：卡片固定高度，展开收纳卡只增滚动内容、不改弹窗尺寸 -->
    <div
      class="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-[1.5cqh] overflow-y-auto py-[2.2cqh] px-[2em] overscroll-contain"
    >
      <!-- 基础设置：常用规则，默认展开；与高级设置一样可点击标题收纳 -->
      <details class="rounded-[0.7em] border-[0.16cqh] border-line bg-paper p-[1em]" open>
        <summary class="cursor-pointer font-bold text-blue">
          {{ strings.ui.room.basicSettings }}
        </summary>
        <div class="mt-[1.5cqh] grid grid-cols-2 gap-[1.5cqh_1.8em]">
          <RuleSelectField
            v-model="localDraft.maxPlayers"
            :label="strings.ui.room.maxPlayersField"
            :options="maxPlayerOptions"
          >
            <small class="text-muted text-fs-12">{{ strings.ui.room.maxPlayersNote }}</small>
          </RuleSelectField>

          <RuleSliderField
            v-model="localDraft.roundsPerPlayer"
            :label="strings.ui.common.roundsField"
            :min="store.config.game.roundsPerPlayer.min"
            :max="store.config.game.roundsPerPlayer.max"
            :step="store.config.game.roundsPerPlayer.step"
            :display="strings.ui.common.roundsUnit(localDraft.roundsPerPlayer)"
          />

          <RuleSliderField
            v-model="localDraft.chooseSeconds"
            :label="strings.ui.room.chooseTimeField"
            :min="store.config.game.chooseSeconds.min"
            :max="store.config.game.chooseSeconds.max"
            :step="store.config.game.chooseSeconds.step"
            :display="
              localDraft.allowChooseTimeLimit
                ? strings.ui.common.secondsUnit(localDraft.chooseSeconds)
                : strings.ui.room.chooseTimeUnlimited
            "
            :disabled="!localDraft.allowChooseTimeLimit"
          />

          <RuleSliderField
            v-model="localDraft.optionCount"
            :label="strings.ui.room.optionCountField"
            :min="store.config.game.optionCount.min"
            :max="store.config.game.optionCount.max"
            :step="store.config.game.optionCount.step"
            :display="strings.ui.room.optionCountUnit(localDraft.optionCount)"
          />

          <RuleSelectField
            v-model="localDraft.joinPolicy"
            :label="strings.ui.room.joinPolicyField"
            :options="joinPolicyOptions"
          />

          <div class="flex flex-col justify-center gap-[1.2cqh]">
            <RuleToggleField
              v-model="localDraft.allowChooseTimeLimit"
              :label="strings.ui.room.toggleChooseTimeLimit"
            />
            <RuleToggleField
              v-model="localDraft.allowPlayerInvite"
              :label="strings.ui.room.togglePlayerInvite"
            />
            <RuleToggleField
              v-model="localDraft.allowWordReroll"
              :label="strings.ui.room.toggleAllowWordReroll"
            />
            <RuleToggleField
              v-model="localDraft.allowCustomWord"
              :label="strings.ui.room.toggleAllowCustomWord"
            />
          </div>
        </div>
      </details>

      <!-- 高级设置：时长回退与计分基数等低频项，默认收起 -->
      <details class="rounded-[0.7em] border-[0.16cqh] border-line bg-paper p-[1em]">
        <summary class="cursor-pointer font-bold text-blue">
          {{ strings.ui.room.advancedSettings }}
        </summary>
        <div class="mt-[1.5cqh] grid grid-cols-3 gap-[1.5cqh_1.4em]">
          <RuleSelectField
            v-model="localDraft.drawSeconds"
            :label="strings.ui.room.drawSecondsField"
            :options="drawSecondsOptions"
          />
          <div class="flex flex-col gap-[0.8cqh]">
            <RuleToggleField
              v-model="localDraft.showWordLength"
              :label="strings.ui.room.toggleShowWordLength"
            />
            <RuleToggleField
              v-model="localDraft.progressiveHints"
              :label="strings.ui.room.toggleProgressiveHints"
            />
            <RuleToggleField v-model="localDraft.allowPause" :label="strings.ui.room.togglePause" />
          </div>
        </div>
      </details>
    </div>

    <template #footer>
      <!-- 底部操作：取消或保存规则 -->
      <p class="mr-auto text-muted text-fs-12">{{ strings.ui.room.rulesChangeNote }}</p>
      <AppButton variant="secondary" type="button" audio-feedback="close" @click="handleClose">
        {{ strings.ui.common.cancel }}
      </AppButton>
      <AppButton variant="primary" type="button" @click="emit('save', localDraft)">
        {{ strings.ui.room.saveRules }}
      </AppButton>
    </template>
  </BaseDialog>
</template>
