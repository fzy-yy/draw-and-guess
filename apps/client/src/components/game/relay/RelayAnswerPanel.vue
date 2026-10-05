<!--
  接龙猜词作答浮层（依据 S41 / S72 / S79 / S86）：
  仅在猜词棒浮于画布上，玩家写下答案并提交，提交后锁定为「等待其他玩家」。
  作画棒的完成提交按钮位于 CanvasToolbar 末尾，避免浮层遮挡画作（S30，见 GameView）。

  为什么复用共享外壳：拖动定位、百分比记账与工作区夹取只在 `DraggablePanelShell` 维护一处（S86），
  本组件只负责猜词输入与提交语义，绝不重复实现拖动。

  锁定态跟随服务端快照：`submitted` 为真（含超时 / 掉线时服务端代交）即锁定；本地提交成功
  只做即时反馈；他人是否已交只由快照 `submittedPlayerIds` 表达（S64）。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTimestamp } from '@vueuse/core'
import { GripVertical, Send } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { AppButton, AppInput } from '@/components/common'
import DraggablePanelShell from '@/components/game/DraggablePanelShell.vue'
import type { PanelPosition } from '@/components/game/FloatingPanel.vue'
import { playInteractionSound } from '@/audio'
import { useGameStore } from '@/stores/game'

const props = defineProps<{
  /** 当前步骤 id：换棒即复位草稿与浮层拖动位置。 */
  stepId: string
  /** 本步是否已提交（服务端快照口径，含服务端代交）。 */
  submitted: boolean
  /** 当前观看者是否可提交（沿用 HUD 的在线可玩成员口径）。 */
  enabled: boolean
}>()

const store = useGameStore()
const defaultClass = 'bottom-[1.2cqh] left-1/2 -translate-x-1/2'
const position = ref<PanelPosition | null>(null)
const now = useTimestamp({ interval: store.config.ui.tickIntervalMs })
const draft = ref('')
const pending = ref(false)
const locallySubmitted = ref(false)

const isSubmitted = computed(() => props.submitted || locallySubmitted.value)
const stepEnded = computed(() => {
  const endsAt = store.room?.relay?.phaseEndsAt ?? 0
  return endsAt > 0 && now.value + store.clockOffset >= endsAt
})
const canSubmit = computed(
  () => props.enabled && !isSubmitted.value && !pending.value && !stepEnded.value,
)
/** 猜词禁止空提交与超长提交（S15 客户端侧）：全空白或超出字符上限不可提交。 */
const canSubmitGuess = computed(
  () =>
    canSubmit.value &&
    draft.value.trim().length > 0 &&
    Array.from(draft.value.trim()).length <= store.config.player.chatMaxLength,
)
const hint = computed(() =>
  stepEnded.value && !isSubmitted.value
    ? strings.ui.game.relayStepEnded
    : strings.ui.game.relayAnswerHint,
)

watch(
  () => props.stepId,
  () => {
    position.value = null
    draft.value = ''
    locallySubmitted.value = false
    pending.value = false
  },
)

/** 服务端代交或正常提交到达后，丢弃已经无效的本地草稿。 */
watch(
  () => props.submitted,
  (submittedNow) => {
    if (submittedNow) draft.value = ''
  },
)

async function submitGuess(): Promise<void> {
  const text = draft.value.trim()
  if (!text || !canSubmitGuess.value) return
  const stepId = props.stepId
  pending.value = true
  try {
    const delivered = await store.relaySubmitGuess(text)
    if (delivered && props.stepId === stepId) {
      locallySubmitted.value = true
      draft.value = ''
      playInteractionSound('activate')
    }
  } finally {
    if (props.stepId === stepId) pending.value = false
  }
}
</script>

<template>
  <DraggablePanelShell
    v-model:position="position"
    :default-class="defaultClass"
    :drag-title="strings.a11y.game.dragAnswerPanelTitle"
    :drag-aria="strings.a11y.game.dragAnswerPanelAria"
  >
    <template #default="{ drag }">
      <div
        class="flex w-[30cqw] flex-col gap-[0.5cqh] rounded-[0.6em] border-[0.35cqh] border-line bg-white/95 px-[0.7em] py-[0.6cqh] shadow-float"
      >
        <!-- 顶行：拖动手柄（绑定与定位来自共用外壳）+ 当前动作提示 -->
        <div class="flex min-w-0 items-center gap-[0.4em]">
          <div v-bind="drag" class="rounded-[0.35em] px-[0.15em] py-[0.2cqh] hover:bg-line/40">
            <GripVertical class="h-[2.4cqh] w-[2.4cqh]" />
          </div>
          <span class="truncate text-fs-12 font-bold text-muted">{{ hint }}</span>
        </div>

        <!-- 猜词棒：输入 + 确定提交；提交后（含服务端代交）整块换成等待态 -->
        <form
          v-if="!isSubmitted"
          class="flex items-center gap-[0.5em]"
          @submit.prevent="submitGuess"
        >
          <AppInput
            v-model="draft"
            size="body"
            class="min-w-0 flex-1"
            :maxlength="store.config.player.chatMaxLength"
            :disabled="!canSubmit"
            :placeholder="strings.ui.game.relayAnswerPlaceholder"
            :aria-label="strings.a11y.game.answerInputAria"
          />
          <AppButton
            type="submit"
            class="shrink-0 gap-[0.35em] px-[1em] text-fs-14"
            :disabled="!canSubmitGuess"
            :audio-feedback="null"
          >
            <Send class="h-[2.4cqh] w-[2.4cqh]" />{{ strings.ui.game.relayAnswerSubmit }}
          </AppButton>
        </form>
        <!-- 已提交（本地即时锁定或服务端快照，含超时 / 掉线代交）：锁定等待其他玩家 -->
        <div
          v-else
          class="flex min-h-[5.2cqh] items-center justify-center gap-[0.4em] rounded-[0.45em] bg-green/10 text-fs-14 font-bold text-success-fg"
        >
          {{ strings.ui.game.relayWaitingOthers }}
        </div>
      </div>
    </template>
  </DraggablePanelShell>
</template>
