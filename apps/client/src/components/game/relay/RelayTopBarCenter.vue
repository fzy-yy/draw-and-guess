<!--
  接龙顶栏正中的答案 UI（S74 / S75），两种形态共用 GameHud 的同一个 `center` 插槽：

  1) 动手期（S74）：**只有一处答案**，左侧按条件挂上一家 chip——
     步 1（自己选的词）没有上一家 → 不渲染 chip；步 2/4（看上一家的画猜词）带画笔角标；
     步 3（按上一家的词作画）不带角标（角标语义见 S73）。
     猜词棒的题面是提示语（配眼睛图标、冷色），作画棒是要画的词（高亮黄色），与经典题目胶囊同一视觉语言。

  2) 复盘 / 投票期（S75 / S76，下发 `showcase` 即切换）：四元组
     `[画家 chip(带角标)] [答案 A] →(箭头) [答案 B] [猜词者 chip]`。
     两个 chip 是这一行里的固定格子：只换 `player` 内容、**不参与任何过渡、元素位置全程不动**（S76）；
     动的是两个答案 UI——半场切换时新左答案从右侧滑入、旧左答案淡出、右侧新的占位淡入，
     服务端揭晓页到达时右答案再淡入显形。时长与占位位数都取自配置包（S70 禁止魔法数字）。
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowRight, Eye, HelpCircle } from 'lucide-vue-next'
import {
  createAnswerMask,
  type RelayPlayerRef,
  type RelayShowcase,
  type RelayViewPhase,
} from '@draw-guess/shared'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import HudPill from '@/components/game/HudPill.vue'
import RelayPlayerChip from '@/components/game/RelayPlayerChip.vue'

const props = defineProps<{
  /**
   * 当前接龙阶段：终局（game_result）没有中央内容，按阶段收敛形态。
   * 可选＝接龙房**还没进入接龙阶段**的开局倒计时期（服务端该期不下发 relay 视图，S22）——
   * 那时按动手期形态渲染占位题面，既不空挂插槽、也不回落成经典题目遮罩。
   */
  phase?: RelayViewPhase
  /** 本棒题面文本（动手期）。 */
  prompt: string
  /** 题面形态：question＝看图猜词的提示语；text＝真正要画的词。 */
  promptKind: 'question' | 'text'
  /** 上一家（步 1 不下发，故为空即不渲染 chip）。 */
  artist?: RelayPlayerRef
  /** 上一家是否带画笔角标（步 2/4 带、步 3 不带）。 */
  artistPaints: boolean
  /** 复盘 / 投票期的双胶囊四元组：下发即切换到复盘形态（S75）。 */
  showcase?: RelayShowcase
}>()

const isQuestion = computed(() => props.promptKind === 'question')

const UNANSWERED = strings.ui.game.relayUnanswered
/** 动手期本棒题目是否为兜底的「上家未作答」（Image 4 灰字 + 问号图标弱化展示）。 */
const isPromptUnanswered = computed(() => !isQuestion.value && props.prompt === UNANSWERED)
/** 复盘左侧题面是否为「上家未作答」。 */
const isLeftUnanswered = computed(() => props.showcase?.prompt.text === UNANSWERED)
/** 复盘过渡旧题面残留层是否为「上家未作答」。 */
const isGhostUnanswered = computed(() => ghostText.value === UNANSWERED)
/** 复盘右侧揭晓答案是否为「上家未作答」。 */
const isRightUnanswered = computed(() => answerText.value === UNANSWERED)
// ── 复盘形态（S75 / S76 / S81）────────────────────────────────────────────────
/**
 * 复盘胶囊过渡时长：参数来自公开配置包，两端（服务端节奏 / 客户端动画）同源。
 * 只有**时长**需要行内注入（它来自配置包，写不进类名）；起止帧全部用行内 Tailwind 类表达。
 */
const transitionMs = APP_CONFIG.relay.capsuleTransitionMs
const transitionStyle = { transitionDuration: `${transitionMs}ms` }
/**
 * 未揭晓占位：字符取经典答案遮罩同款（`createAnswerMask` 输出 `＿`），位数取配置的固定值——
 * 服务端在揭晓前既不下发答案文本、也不下发它的长度（S81），客户端只能按固定位数渲染。
 */
const HIDDEN_ANSWER_PLACEHOLDER = createAnswerMask('x'.repeat(APP_CONFIG.relay.hiddenAnswerChars))

/** 右侧答案文本：`null` 表示服务端尚未揭晓（重播 / 停顿页）。 */
const answerText = computed(() => props.showcase?.answer.text ?? null)
/** 揭晓与否完全由服务端快照决定，客户端不再自行推算时间窗。 */
const revealed = computed(() => answerText.value !== null)
/** 半场键（链序号 + 半场）：变化即一整段「半场切换」过渡（S76）。 */
const halfKey = computed(() => {
  const showcase = props.showcase
  return showcase ? `${showcase.chainIndex}-${showcase.half}` : ''
})

/** 过渡起始帧标记：置真摆出「新左答案在右且透明、右答案透明」的起手，翻假由 CSS 过渡到落定帧。 */
const shifting = ref(false)
/** 过渡期间覆盖在左胶囊之上的旧答案（渐隐离场），落定后清除。 */
const ghostText = ref<string | null>(null)
/** 上一次已落定的左答案文本：半场切换时它就是需要渐隐的旧答案。 */
const settledLeftText = ref('')
let settleTimer: ReturnType<typeof setTimeout> | undefined

/** 左答案起手帧：从右侧答案的位置滑入（对应 S76 的「右答案平移到左」）。 */
const leftCapsuleClass = computed(() =>
  shifting.value ? 'translate-x-[6cqw] opacity-0' : 'translate-x-0 opacity-100',
)
/** 旧左答案残留层：起手帧不透明，落定帧淡出（对应 S76 的「左答案渐隐」）。 */
const ghostCapsuleClass = computed(() => (shifting.value ? 'opacity-100' : 'opacity-0'))
/** 右答案：过渡起手与未揭晓时都淡，揭晓落定后显形（占位期半透明）。 */
const rightCapsuleClass = computed(() =>
  shifting.value ? 'opacity-0' : revealed.value ? 'opacity-100' : 'opacity-40',
)

/** 半场切换：摆起手帧 → 翻帧触发过渡 → 过渡结束后清掉残留层。 */
async function playHalfTransition(previousLeftText: string): Promise<void> {
  if (settleTimer !== undefined) clearTimeout(settleTimer)
  ghostText.value = previousLeftText
  shifting.value = true
  await nextTick()
  shifting.value = false
  settleTimer = setTimeout(() => {
    ghostText.value = null
    settleTimer = undefined
  }, transitionMs)
}

watch(
  halfKey,
  (key, previousKey) => {
    const nextLeftText = props.showcase?.prompt.text ?? ''
    // 首次出现（从动手期/加载进入复盘）没有「上一段」，直接落定，不播过渡
    if (!key || !previousKey) {
      settledLeftText.value = nextLeftText
      return
    }
    const outgoing = settledLeftText.value
    settledLeftText.value = nextLeftText
    void playHalfTransition(outgoing)
  },
  { immediate: true },
)

/** 投票阶段题面切换为初始词时，同步更新已落定文本（确保下一条链起跑时旧答案残留层渐隐正确的题面） */
watch(
  () => props.showcase?.prompt.text,
  (nextText) => {
    if (!shifting.value && nextText) {
      settledLeftText.value = nextText
    }
  },
)
onBeforeUnmount(() => {
  if (settleTimer !== undefined) clearTimeout(settleTimer)
})
</script>

<template>
  <!-- 复盘 / 投票形态：四元组四个格子固定，chip 只换内容不移动（S75 / S76） -->
  <div v-if="props.showcase" class="flex min-w-0 items-center gap-[0.6cqw]">
    <!-- 左 chip＝画家：位置固定，元素不参与过渡；角标＝本半场是他在画（S73） -->
    <RelayPlayerChip :player="props.showcase.prompt.player" :brush-badge="true" />
    <div class="relative flex min-w-0 items-center">
      <!-- 答案 A：半场切换时从右侧滑入（旧答案由下方 ghost 层渐隐） -->
      <HudPill
        class="min-w-[9cqw] max-w-[20cqw] justify-center px-[1em] transition-[transform,translate,opacity] ease-out"
        :class="leftCapsuleClass"
        :style="transitionStyle"
      >
        <b
          class="flex items-center gap-[0.3em] truncate text-fs-20 tracking-[0.12em]"
          :class="isLeftUnanswered ? 'text-muted' : 'text-yellow'"
        >
          <HelpCircle
            v-if="isLeftUnanswered"
            class="h-[2.4cqh] w-[2.4cqh] shrink-0"
            aria-hidden="true"
          />
          <span class="truncate">{{ props.showcase.prompt.text ?? '' }}</span>
        </b>
      </HudPill>
      <!-- 旧答案 A 的残留层：与左胶囊同尺寸叠放，过渡期间淡出，绝不影响行内布局 -->
      <HudPill
        v-if="ghostText !== null"
        class="absolute inset-0 justify-center px-[1em] transition-opacity ease-out"
        :class="ghostCapsuleClass"
        :style="transitionStyle"
        aria-hidden="true"
      >
        <b
          class="flex items-center gap-[0.3em] truncate text-fs-20 tracking-[0.12em]"
          :class="isGhostUnanswered ? 'text-muted' : 'text-yellow'"
        >
          <HelpCircle
            v-if="isGhostUnanswered"
            class="h-[2.4cqh] w-[2.4cqh] shrink-0"
            aria-hidden="true"
          />
          <span class="truncate">{{ ghostText }}</span>
        </b>
      </HudPill>
    </div>
    <ArrowRight class="h-[3cqh] w-[3cqh] shrink-0 text-sky" aria-hidden="true" />
    <!-- 答案 B：未揭晓时按固定位数渲染经典遮罩同款下划线（S81），揭晓后淡入真答案 -->
    <HudPill
      class="min-w-[9cqw] max-w-[20cqw] justify-center px-[1em] transition-opacity ease-out"
      :class="rightCapsuleClass"
      :style="transitionStyle"
    >
      <b
        v-if="revealed"
        class="flex items-center gap-[0.3em] truncate text-fs-20 tracking-[0.12em]"
        :class="isRightUnanswered ? 'text-muted' : 'text-white'"
      >
        <HelpCircle
          v-if="isRightUnanswered"
          class="h-[2.4cqh] w-[2.4cqh] shrink-0"
          aria-hidden="true"
        />
        <span class="truncate">{{ answerText }}</span>
      </b>
      <!-- 未揭晓：可见的下划线只是占位图形，读屏改听「答案尚未揭晓」（a11y 与 ui 分列） -->
      <template v-else>
        <span class="sr-only">{{ strings.a11y.game.relayHiddenAnswerAria }}</span>
        <b class="truncate text-white text-fs-20 tracking-[0.12em]" aria-hidden="true">{{
          HIDDEN_ANSWER_PLACEHOLDER
        }}</b>
      </template>
    </HudPill>
    <!-- 右 chip＝猜词者：位置固定，角标恒不挂（他给的是词不是画） -->
    <RelayPlayerChip :player="props.showcase.answer.player" />
  </div>

  <!-- 动手期形态（S74）：只有一个答案 UI；终局没有中央内容，故此处不渲染（留空节点占住插槽） -->
  <div v-else-if="props.phase !== 'game_result'" class="flex min-w-0 items-center gap-[0.6cqw]">
    <RelayPlayerChip v-if="props.artist" :player="props.artist" :brush-badge="props.artistPaints" />
    <HudPill
      class="min-w-[16cqw] max-w-[34cqw] justify-center px-[1.2em]"
      :class="isQuestion || isPromptUnanswered ? 'bg-white/10' : ''"
    >
      <b
        class="flex items-center gap-[0.4em] text-fs-24 tracking-[0.16em]"
        :class="isQuestion ? 'text-sky' : isPromptUnanswered ? 'text-muted' : 'text-yellow'"
      >
        <Eye v-if="isQuestion" class="h-[3cqh] w-[3cqh]" aria-hidden="true" />
        <HelpCircle v-else-if="isPromptUnanswered" class="h-[3cqh] w-[3cqh]" aria-hidden="true" />
        {{ props.prompt }}
      </b>
    </HudPill>
  </div>
</template>
