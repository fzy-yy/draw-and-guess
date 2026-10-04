<!--
  房间规则编辑弹窗（房主）——两列等高栅格陈列全部规则字段，保存前可取消。
  原 RoomView.vue 规则弹窗迁入本组件，基于 BaseDialog 复用外壳。
  父组件持有草稿（draft prop），本组件用本地副本编辑（避免修改 props），保存时把副本通过 save 上抛。

  布局与控件约定（取舍见 docs/adr/0051-rules-dialog-flat-grid-and-dropdown-fields.md）：
  - 取消「基础设置 / 高级设置」收纳：字段本就不多，收纳只多一次点击，平铺后一行两个更整齐；
  - 下拉字段排在前、复选框字段排在后，同类同行；区间字段（作画次数/选词时间/候选词）一律用下拉而非
    滑块——档位只有 4~6 档，下拉能一次列出全部取值，比滑块更精确也更省纵向空间；
  - 卡片固定高度（h-[82cqh]）+ 表单区滚动：弹窗尺寸恒定，不做「展开撑大」；
  - 容量（人数上限）与中途加入策略已随观战/候场删除，不再是房间规则字段；
  - 旧「玩法预设」与「计分方式」下拉已移除：预设取消（唯一默认组见 config roomSettingsDefaults），
    计分固定为固定 100 分制（见 docs/adr/0047-fixed-100-point-scoring.md）。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { strings } from '@draw-guess/strings'
import type { RoomSettings } from '@draw-guess/shared'
import { defaultRoomSettings } from '@draw-guess/config'
import BaseDialog from '@/components/common/BaseDialog.vue'
import AppButton from '@/components/common/AppButton.vue'
import SectionHeader from '@/components/common/SectionHeader.vue'
import RuleSelectField, { type RuleSelectOption } from '@/components/common/RuleSelectField.vue'
import RuleToggleField from '@/components/common/RuleToggleField.vue'
import { useGameStore } from '@/stores/game'

/** 「选词时间」合并下拉的值域：不限时，或具体秒数（见下方 chooseTime 代理）。 */
type ChooseTimeValue = 'unlimited' | number

const open = defineModel<boolean>('open', { default: false })
const props = withDefaults(
  defineProps<{
    draft?: RoomSettings
    readOnly?: boolean
  }>(),
  { draft: undefined, readOnly: false },
)
const emit = defineEmits<{ save: [draft: RoomSettings] }>()
const store = useGameStore()

/** 关闭弹窗：只写 v-model:open（BaseDialog 自身的关闭路径也会写回 false，不再向上抛 close）。 */
function handleClose(): void {
  open.value = false
}

/**
 * 把「最小值 / 最大值 / 步进」区间展开为取值列表。
 * 区间与步进一律取自公开配置（packages/config/src/game.ts），禁止在组件里另写一套数值范围；
 * 展开后用 strings 的格式化函数拼标签，保证与摘要、提示文案同一口径。
 */
function rangeValues(range: { min: number; max: number; step: number }): number[] {
  const values: number[] = []
  for (let value = range.min; value <= range.max; value += range.step) values.push(value)
  return values
}

/**
 * 下拉选项：数值范围/枚举值一律来自公开配置与 strings。
 * 容量固定为协议常量，已不再出现在规则里。
 */
const roundsOptions: Array<RuleSelectOption<number>> = rangeValues(
  store.config.game.roundsPerPlayer,
).map((rounds) => ({ value: rounds, label: strings.ui.common.roundsUnit(rounds) }))
const optionCountOptions: Array<RuleSelectOption<number>> = rangeValues(
  store.config.game.optionCount,
).map((count) => ({ value: count, label: strings.ui.room.optionCountUnit(count) }))
/**
 * 单回合时长档位：合法值来自公开配置（唯一来源是协议常量），
 * 展示文案由 strings 统一格式化；不使用原生 <select>。
 */
const drawSecondsOptions: RuleSelectOption<RoomSettings['drawSeconds']>[] =
  store.config.game.drawSeconds.options.map((seconds) => ({
    value: seconds,
    label: strings.ui.common.secondsUnit(seconds),
  }))
/** 选词时间：把 allowChooseTimeLimit 与 chooseSeconds 合成一个下拉（见下方 chooseTime）。 */
const chooseTimeOptions: Array<RuleSelectOption<ChooseTimeValue>> = [
  { value: 'unlimited', label: strings.ui.room.chooseTimeUnlimited },
  ...rangeValues(store.config.game.chooseSeconds).map((seconds) => ({
    value: seconds,
    label: strings.ui.common.secondsUnit(seconds),
  })),
]

// 本地编辑副本：所有字段均为原始值，浅拷贝即可；每次打开（draft 变化）时重新同步。
// 初值用配置工厂生成完整合法对象，避免用类型断言绕过 RoomSettings 的字段约束。
const localDraft = ref<RoomSettings>(defaultRoomSettings())
watch(
  () => props.draft,
  (draft) => {
    if (draft) localDraft.value = { ...draft }
  },
  { immediate: true },
)

/**
 * 「选词时间」的读写代理：协议里它是 allowChooseTimeLimit + chooseSeconds 两个字段，
 * 界面上只是「多久」一个问题——选「不限时」即关闭开关，选具体秒数才打开开关并写入秒数；
 * 切回「不限时」时保留原 chooseSeconds，下次再开限时沿用用户上次的选择（见 ADR-0045）。
 */
const chooseTime = computed<ChooseTimeValue>({
  get: () => (localDraft.value.allowChooseTimeLimit ? localDraft.value.chooseSeconds : 'unlimited'),
  set: (value) => {
    if (value === 'unlimited') {
      localDraft.value.allowChooseTimeLimit = false
      return
    }
    localDraft.value.allowChooseTimeLimit = true
    localDraft.value.chooseSeconds = value
  },
})
</script>

<template>
  <!-- 规则编辑表单：两列等高栅格；下拉字段在前、复选框字段在后（同类同行，逐行左→右填充） -->
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

    <!-- 表单区在弹窗内自行滚动：卡片高度固定，内容超出才由滚动条容纳。
         行高用 minmax 下限而非写死 h：下拉字段的自然高约 8.4cqh（1280×720）～8.6cqh（1024×576，
         字号像素下限在低高度舞台下占比更大），下限取 8.7cqh 既高于该自然高，
         又让「7 行（4 个下拉 + 9 个开关，两列）+ 行距 + 上下内边距」收在卡片可用高度内（不出现无谓滚动条）；
         极小舞台下字号下限把内容撑高时，该行自行变高而不裁切。 -->
    <div
      class="grid min-h-0 flex-1 auto-rows-[minmax(8.7cqh,auto)] grid-cols-2 content-start gap-x-[1.8em] gap-y-[1.5cqh] overflow-y-auto py-[1.6cqh] px-[2em] overscroll-contain"
    >
      <RuleSelectField
        v-model="localDraft.roundsPerPlayer"
        :label="strings.ui.common.roundsField"
        :options="roundsOptions"
        :disabled="readOnly"
      />

      <RuleSelectField
        v-model="localDraft.drawSeconds"
        :label="strings.ui.room.drawSecondsField"
        :options="drawSecondsOptions"
        :disabled="readOnly"
      />

      <RuleSelectField
        v-model="chooseTime"
        :label="strings.ui.room.chooseTimeField"
        :options="chooseTimeOptions"
        :disabled="readOnly"
      />

      <RuleSelectField
        v-model="localDraft.optionCount"
        :label="strings.ui.room.optionCountField"
        :options="optionCountOptions"
        :disabled="readOnly"
      />

      <!-- 复选框字段保持自身高度，在固定行高里垂直居中（self-center），不随行高拉伸 -->
      <RuleToggleField
        v-model="localDraft.allowPlayerInvite"
        class="self-center"
        :label="strings.ui.room.togglePlayerInvite"
        :disabled="readOnly"
      />
      <RuleToggleField
        v-model="localDraft.allowWordReroll"
        class="self-center"
        :label="strings.ui.room.toggleAllowWordReroll"
        :disabled="readOnly"
      />
      <RuleToggleField
        v-model="localDraft.allowCustomWord"
        class="self-center"
        :label="strings.ui.room.toggleAllowCustomWord"
        :disabled="readOnly"
      />
      <RuleToggleField
        v-model="localDraft.showWordLength"
        class="self-center"
        :label="strings.ui.room.toggleShowWordLength"
        :disabled="readOnly"
      />
      <RuleToggleField
        v-model="localDraft.progressiveHints"
        class="self-center"
        :label="strings.ui.room.toggleProgressiveHints"
        :disabled="readOnly"
      />
      <RuleToggleField
        v-model="localDraft.allowPause"
        class="self-center"
        :label="strings.ui.room.togglePause"
        :disabled="readOnly"
      />
      <RuleToggleField
        v-model="localDraft.allowNearMissHint"
        class="self-center"
        :label="strings.ui.room.nearMissHintLabel"
        :disabled="readOnly"
      />
      <RuleToggleField
        v-model="localDraft.allowCanvasReactions"
        class="self-center"
        :label="strings.ui.room.canvasReactionsLabel"
        :disabled="readOnly"
      />
      <RuleToggleField
        v-model="localDraft.allowRoundReplay"
        class="self-center"
        :label="strings.ui.room.roundReplayLabel"
        :disabled="readOnly"
      />
    </div>

    <template #footer>
      <!-- 底部操作：只读时仅有关闭按钮；可编辑时取消或保存规则 -->
      <p v-if="!readOnly" class="mr-auto text-muted text-fs-12">
        {{ strings.ui.room.rulesChangeNote }}
      </p>
      <AppButton
        v-if="readOnly"
        class="ml-auto"
        variant="primary"
        type="button"
        audio-feedback="close"
        @click="handleClose"
      >
        {{ strings.ui.common.close }}
      </AppButton>
      <template v-else>
        <AppButton variant="secondary" type="button" audio-feedback="close" @click="handleClose">
          {{ strings.ui.common.cancel }}
        </AppButton>
        <AppButton variant="primary" type="button" @click="emit('save', localDraft)">
          {{ strings.ui.room.saveRules }}
        </AppButton>
      </template>
    </template>
  </BaseDialog>
</template>
