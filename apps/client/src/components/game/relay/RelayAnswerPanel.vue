<!--
  接龙作答浮层（工单 10；依据 S41 / S72 / S79 / S86）：
  轮到猜词时浮在画布上，玩家写下答案并提交，提交后立刻锁定为「等待其他玩家」；
  作画棒则在同一浮层用「完成提交」把已有笔画交给下一位（S30：只标记完成，不改画布）。

  为什么复用共享外壳：拖动定位、百分比记账与工作区夹取只在 `DraggablePanelShell` 维护一处（S86），
  本组件只负责视觉与提交语义，绝不重复实现拖动。

  锁定态的铁律是「跟随服务端快照」：`submitted` 为真（含超时 / 掉线时服务端代交）即锁定，
  本地提交成功只做即时反馈（乐观锁定，ack 回来前先锁住）；他人是否已交只由快照的
  `submittedPlayerIds` 表达，客户端不自行推断（S64 / 工单 10 第 3 条）。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, GripVertical, Send } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { AppButton, AppInput } from '@/components/common'
import DraggablePanelShell from '@/components/game/DraggablePanelShell.vue'
import type { PanelPosition } from '@/components/game/FloatingPanel.vue'
import { playInteractionSound } from '@/audio'
import { useGameStore } from '@/stores/game'

const props = defineProps<{
  /** 本步 id：换棒即复位浮层（锁定态、草稿与拖动位置都不跨棒残留）。 */
  stepId: string
  /** 本浮层收集的动作：guess＝提交猜词文本；draw＝完成本棒作画。 */
  mode: 'guess' | 'draw'
  /** 本步是否已提交（服务端快照口径，含服务端代交）。 */
  submitted: boolean
  /** 当前观看者是否可提交（沿用 HUD 的「在线可玩成员」口径）。 */
  enabled: boolean
}>()

const store = useGameStore()

/** 拖动位置（null＝按 defaultClass 停靠）；随 stepId 复位。 */
const position = ref<PanelPosition | null>(null)
/** 猜词草稿：提交成功、快照判定已交或换棒时清空。 */
const draft = ref('')
/** 请求在途：防止重复提交。 */
const pending = ref(false)
/** 本地提交成功的即时锁定；服务端快照仍是权威（`submitted` 一到即等价）。 */
const locallySubmitted = ref(false)

const isSubmitted = computed(() => props.submitted || locallySubmitted.value)
const canSubmit = computed(() => props.enabled && !isSubmitted.value && !pending.value)
/** 猜词禁止空提交（S15 客户端侧）：全空白同样不可提交。 */
const canSubmitGuess = computed(() => canSubmit.value && draft.value.trim().length > 0)

const hint = computed(() =>
  props.mode === 'guess' ? strings.ui.game.relayAnswerHint : strings.ui.game.relayDrawingHint,
)

/**
 * 默认停靠：猜词棒没有底部工具条，贴底居中最好按；作画棒底部被工具条占用，
 * 改停顶部居中——两处都避开画布中心，拖动后由玩家自行安排。
 */
const defaultClass = computed(() =>
  props.mode === 'guess'
    ? 'bottom-[1.2cqh] left-1/2 -translate-x-1/2'
    : 'top-[1.2cqh] left-1/2 -translate-x-1/2',
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

/** 快照已判定提交（含服务端代交）时丢弃草稿：内容已无意义，留着只会在下一棒误发。 */
watch(
  () => props.submitted,
  (submittedNow) => {
    if (submittedNow) draft.value = ''
  },
)

/**
 * 提交本棒猜词：走 `relay:submitGuess`（S20 的作答专用通道，绝不经过聊天事件）。
 * 只有 ack 成功才即时锁定；失败时保留草稿与可重试状态（失败提示由传输层统一 Toast）。
 */
async function submitGuess(): Promise<void> {
  const text = draft.value.trim()
  if (!text || !canSubmitGuess.value) return
  const stepId = props.stepId
  pending.value = true
  try {
    const delivered = await store.relaySubmitGuess(text)
    // 换棒后才回来的旧 ack 不得锁住新一棒。
    if (delivered && props.stepId === stepId) {
      locallySubmitted.value = true
      draft.value = ''
      playInteractionSound('activate')
    }
  } finally {
    if (props.stepId === stepId) pending.value = false
  }
}

/** 提交本棒作画（`relay:submitDrawing`）：只标记完成，交的是画布上已有笔画（S30）。 */
async function submitDrawing(): Promise<void> {
  if (!canSubmit.value) return
  const stepId = props.stepId
  pending.value = true
  try {
    const delivered = await store.relaySubmitDrawing()
    if (delivered && props.stepId === stepId) {
      locallySubmitted.value = true
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
          v-if="mode === 'guess' && !isSubmitted"
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

        <!-- 作画棒：只标记完成，交的是画布上已有笔画（S30） -->
        <AppButton
          v-else-if="mode === 'draw' && !isSubmitted"
          type="button"
          class="gap-[0.35em] text-fs-14"
          :disabled="!canSubmit"
          :audio-feedback="null"
          @click="submitDrawing"
        >
          <Check class="h-[2.4cqh] w-[2.4cqh]" />{{ strings.ui.game.relayDrawingSubmit }}
        </AppButton>

        <!-- 已提交（本地即时锁定或服务端快照，含超时 / 掉线代交）：锁定等待其他玩家 -->
        <div
          v-else
          class="flex min-h-[5.2cqh] items-center justify-center gap-[0.4em] rounded-[0.45em] bg-green/10 text-fs-14 font-bold text-success-fg"
        >
          <Check class="h-[2.4cqh] w-[2.4cqh]" />{{ strings.ui.game.relayWaitingOthers }}
        </div>
      </div>
    </template>
  </DraggablePanelShell>
</template>
