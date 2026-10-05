<!--
  对局顶栏 HUD（黄金三栏布局版）：
  回合数、题目（画家明文 / 猜词者遮罩）、倒计时、网络状态与提前结束/设置/全屏操作。
  已删除「当前画家」信息块与结构化提示区：前者由左栏玩家面板回答，后者随结构化提示一并移除（见 ADR-0042）。
  高度取 11cqh，与大厅 / 房间 / 设置页顶栏保持统一节奏与高度基线。
  组件只读 store 的公开状态；HUD 派生值（计时/进度/答案）由父组件经 props 传入，整局 ticker 只在 GameView。
  左右侧面板已改为流内常驻布局，不再由顶栏提供显隐开关。
  `leading` / `center` 插槽（S84）：接龙把左栏（模式 + 阶段 + 棒次）与正中（上一家 chip + 单个答案 UI）
  换成分属接龙的呈现；两个插槽都不传时按现状渲染经典回合胶囊与题目胶囊，经典行为逐条不变。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CircleStop, Clock3, Maximize, Minimize, Settings } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { GameView } from '@draw-guess/shared'
import { playInteractionSound } from '@/audio'
import { useGameStore } from '@/stores/game'
import { IconButton, NetworkStatusButton } from '@/components/common'
import HudPill from '@/components/game/HudPill.vue'

const props = withDefaults(
  defineProps<{
    isFullscreen: boolean
    game: GameView | undefined
    secondsLeft: number
    progress: number
    isReplaying?: boolean
    /**
     * 房主此时能否提前结束本局（阶段守卫在父组件，与服务端 `endEarly` 同口径）。
     * 为真才渲染提前结束按钮：非房主、开局倒计时与接龙复盘期都不出现。
     */
    canEndEarly?: boolean
    /**
     * 本阶段截止时间（可选的模式无关口径）：经典由父组件传 `game.phaseEndsAt`；
     * 接龙的截止时间在接龙视图里，父组件改传接龙视图的 `phaseEndsAt`，倒计时与进度条因此两模式共用。
     * 不传时回落到对局视图的原字段，经典路径逐条不变。
     */
    phaseEndsAt?: number
  }>(),
  { isReplaying: false, canEndEarly: false, phaseEndsAt: undefined },
)
const emit = defineEmits<{
  /** 打开对局内设置弹窗（父组件维护弹窗开关）。 */
  settings: []
  /** 切换全屏（父组件操作全屏 API）。 */
  'toggle-fullscreen': []
  /** 请求提前结束本局（父组件弹确认框，真正的结算仍归服务端）。 */
  'end-early': []
}>()

const store = useGameStore()

/**
 * 回合显示钳制到 1～总回合：服务端 currentRound 在开局倒计时阶段为 0（进入首个选词才自增为 1），
 * 直接展示会出现「ROUND 0 / 4」。这里纯展示层修正为 1-indexed，与服务端 finishGame 收敛
 * currentRound 不越上界的处理对称，不改动权威数据。
 */
const roundDisplay = computed(() => {
  const game = props.game
  if (!game) return 0
  return Math.min(Math.max(game.currentRound, 1), game.totalRounds)
})

/**
 * 当前阶段是否有截止时间：`phaseEndsAt = 0` 是本项目「本阶段无截止时间」的哨兵
 * （等待 / 终局等阶段不排计时），此时不渲染进度条。
 * 截止时间优先取父组件传入的模式无关字段（接龙视图与对局视图各有一份），缺省回落到对局视图。
 */
const phaseEndsAt = computed(() => props.phaseEndsAt ?? props.game?.phaseEndsAt ?? 0)
const hasDeadline = computed(() => phaseEndsAt.value > 0)

/** 最后 10 秒（且未归零）进入紧急样式：计时器底色与进度条同步变红。 */
const isUrgent = computed(
  () =>
    hasDeadline.value &&
    props.secondsLeft <= store.config.game.warningSeconds &&
    props.secondsLeft > 0,
)

/**
 * 画家答案显示状态：
 * 默认遵循用户本地偏好 store.settings.drawerDefaultReveal；画家可点击题目胶囊切换明文/遮罩，
 * 猜词者恒为服务端下发的逐字遮罩（结构化提示已移除，切换只剩「明文 / 遮罩」，见 ADR-0042）。
 */
const drawerRevealed = ref(store.settings.drawerDefaultReveal)

// 题目变更或偏好变更时，按最新偏好重置显隐状态，避免沿用上一题的临时选择。
watch(
  () => [props.game?.answer, store.settings.drawerDefaultReveal],
  () => {
    drawerRevealed.value = store.settings.drawerDefaultReveal
  },
)

function toggleDrawerAnswerReveal(): void {
  if (!store.isDrawer) return
  playInteractionSound('select')
  drawerRevealed.value = !drawerRevealed.value
}

/** 题目展示：画家按显隐状态在明文与遮罩间切换，猜词者恒为遮罩。 */
const displayedAnswer = computed(() => {
  if (props.isReplaying) return strings.ui.game.replayingDrawing
  if (store.isDrawer && drawerRevealed.value && props.game?.answer) return props.game.answer
  return props.game?.answerMask || strings.ui.game.awaitingWord
})

/** 呈现给用户的剩余秒数（回合结算前若有重播，重播期间为倒计时，结束后为结算倒计时） */
const displaySeconds = computed(() => {
  if (props.isReplaying) {
    const nonReplaySeconds =
      store.config.game.roundResultSeconds + store.config.game.roundReplayPauseSeconds
    return Math.max(1, props.secondsLeft - nonReplaySeconds)
  }
  if (store.room?.phase === 'round_result') {
    return Math.min(store.config.game.roundResultSeconds, props.secondsLeft)
  }
  return props.secondsLeft
})
</script>

<template>
  <!-- 顶栏：ROUND 在最左，面板开关紧随其右；中间题目、右侧倒计时与系统操作 -->
  <header
    v-if="store.room"
    :aria-label="strings.a11y.game.topBarAria"
    class="grid h-[11cqh] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[1cqw] border-b-[0.45cqh] border-yellow bg-navy px-[1.2cqw] text-white"
  >
    <!-- 左：回合胶囊（左栏与右栏已常驻，无需显隐开关）；接龙经 leading 插槽换成模式 + 阶段 + 棒次 -->
    <div class="flex items-center gap-[0.5cqw]">
      <slot name="leading">
        <HudPill class="shrink-0">
          <span class="text-sky text-fs-12">{{ strings.ui.game.roundLabel }}</span>
          <b class="text-white text-fs-24 leading-none tabular-nums">
            <span class="inline-block min-w-[2ch] text-center">{{ roundDisplay }}</span>
            <small class="text-fs-10 text-sky"
              >{{ strings.ui.game.roundSeparator }}{{ game?.totalRounds }}</small
            >
          </b>
        </HudPill>
      </slot>
    </div>

    <!-- 中：题目（画家可点击切换明文/遮罩，猜词者恒为遮罩）；单元素居中用 grid place-items-center。
         接龙经 center 插槽换成「上一家 chip + 单个答案 UI」，两者都复用同一条胶囊视觉语言。 -->
    <div class="grid min-w-0 place-items-center">
      <slot name="center">
        <HudPill
          class="min-w-[16cqw] max-w-[34cqw] justify-center px-[1.2em] transition-colors"
          :class="{
            'cursor-pointer select-none hover:bg-white/15 active:bg-white/20': store.isDrawer,
          }"
          :role="store.isDrawer ? 'button' : undefined"
          :tabindex="store.isDrawer ? 0 : undefined"
          :aria-label="store.isDrawer ? strings.a11y.game.toggleAnswerVisibilityAria : undefined"
          :title="store.isDrawer ? strings.a11y.game.toggleAnswerVisibilityHint : undefined"
          @click="toggleDrawerAnswerReveal"
          @keydown.enter.prevent="toggleDrawerAnswerReveal"
          @keydown.space.prevent="toggleDrawerAnswerReveal"
        >
          <b class="flex items-center text-yellow text-fs-24 tracking-[0.16em]">{{
            displayedAnswer
          }}</b>
        </HudPill>
      </slot>
    </div>

    <!-- 右：倒计时 + 网络状态 + 提前结束（房主）/ 设置 / 全屏 -->
    <div class="flex items-center gap-[0.5cqw]">
      <!--
        倒计时胶囊：固定 3 位数字等宽容器（w-[3ch] text-center tabular-nums），
        位数减少（120 至 99 至 8）时数字居中且组件长度恒定；不显示“秒”单位。
      -->
      <HudPill
        class="relative box-border justify-center gap-[0.35em] overflow-hidden px-[0.65em]"
        :class="{ 'bg-red': isUrgent }"
      >
        <Clock3 class="h-[2.5cqh] w-[2.5cqh] shrink-0" />
        <b class="w-[3ch] shrink-0 text-center text-fs-24 tabular-nums leading-none">
          {{ displaySeconds }}
        </b>
        <i
          v-if="hasDeadline"
          class="absolute bottom-0 left-0 h-[0.45cqh] w-full origin-left"
          :class="isUrgent ? 'bg-yellow' : 'bg-green'"
          :style="{ transform: `scaleX(${progress})` }"
        ></i>
      </HudPill>
      <NetworkStatusButton
        :connected="store.connected"
        :latency="store.latency"
        :connection-label="store.connectionLabel"
        :latency-good-ms="store.config.network.latencyGoodMs"
      />
      <!-- 提前结束：仅房主且处于可结算的对局阶段时出现（服务端 endEarly 守卫同口径），
           点击只弹确认框，真正的结算与入账仍由服务端裁决。 -->
      <IconButton
        v-if="canEndEarly"
        :label="strings.a11y.game.endEarlyAria"
        @click="emit('end-early')"
      >
        <CircleStop />
      </IconButton>
      <IconButton :label="strings.a11y.game.settingsAria" @click="emit('settings')">
        <Settings />
      </IconButton>
      <IconButton
        :label="
          isFullscreen
            ? strings.a11y.game.exitFullscreenAria
            : strings.a11y.game.enterFullscreenAria
        "
        @click="emit('toggle-fullscreen')"
      >
        <Minimize v-if="isFullscreen" /><Maximize v-else />
      </IconButton>
    </div>
  </header>
</template>
