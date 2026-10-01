<!--
  对局顶栏 HUD（浮层布局版）：
  回合数、题目（画家明文 / 猜词者遮罩）、倒计时、网络状态与暂停/设置/全屏操作，
  并在 ROUND 之右并入玩家 / 聊天 / 工具三个面板开关。
  已删除「当前画家」信息块与结构化提示区：前者由玩家面板回答，后者随结构化提示一并移除（见 ADR-0042）。
  组件只读 store 的公开状态；HUD 派生值（计时/进度/答案）由父组件经 props 传入，整局 ticker 只在 GameView。
  面板开关状态经 v-model 与父组件共用，面板内关闭按钮写同一份 open，因此顶栏开关天然同步。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  CirclePause,
  CirclePlay,
  Clock3,
  Maximize,
  MessageSquare,
  Minimize,
  Palette,
  Settings,
  Users,
} from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import type { GameView } from '@draw-guess/shared'
import { playInteractionSound } from '@/audio'
import { useGameStore } from '@/stores/game'
import { IconButton, NetworkStatusButton, SquareIconButton } from '@/components/common'
import HudPill from '@/components/game/HudPill.vue'

const props = defineProps<{
  /** 是否处于全屏：用于切换全屏/退出全屏图标与无障碍标签。 */
  isFullscreen: boolean
  /** 对局视图（回合/答案/遮罩等），由 useGameHud 派生。 */
  game: GameView | undefined
  /** 当前阶段剩余秒数。 */
  secondsLeft: number
  /** 当前阶段剩余进度（0～1），供进度条 scaleX。 */
  progress: number
  /** 是否展示「工具」面板开关（仅画家）。 */
  showTools: boolean
}>()
const emit = defineEmits<{
  /** 打开对局内设置弹窗（父组件维护弹窗开关）。 */
  settings: []
  /** 切换全屏（父组件操作全屏 API）。 */
  'toggle-fullscreen': []
}>()

const playersOpen = defineModel<boolean>('playersOpen', { required: true })
const chatOpen = defineModel<boolean>('chatOpen', { required: true })
const toolsOpen = defineModel<boolean>('toolsOpen', { required: true })

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

/** 最后 10 秒（且未归零）进入紧急样式：计时器底色与进度条同步变红。 */
const isUrgent = computed(
  () => props.secondsLeft <= store.config.game.warningSeconds && props.secondsLeft > 0,
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
  if (store.isDrawer && drawerRevealed.value && props.game?.answer) return props.game.answer
  return props.game?.answerMask || strings.game.awaitingWord
})

/** 单按钮处理暂停与恢复切换：暂停时房主点击恢复，运行中点击暂停或请求暂停。 */
function handlePauseToggle(): void {
  if (store.room?.phase === 'paused') {
    if (store.isHost) {
      void store.resume()
    }
  } else {
    void store.pause(store.isHost ? strings.game.pauseReasonHost : strings.game.pauseReasonGuest)
  }
}
</script>

<template>
  <!-- 顶栏：ROUND 在最左，面板开关紧随其右；中间题目、右侧倒计时与系统操作 -->
  <header
    v-if="store.room"
    :aria-label="strings.game.topBarAria"
    class="grid h-[9cqh] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[1cqw] border-b-[0.45cqh] border-yellow bg-navy px-[1.2cqw] text-white"
  >
    <!-- 左：回合胶囊 + 玩家 / 聊天 / 工具面板开关 -->
    <div class="flex items-center gap-[0.5cqw]">
      <HudPill class="shrink-0">
        <span class="text-sky text-fs-12">{{ strings.game.roundLabel }}</span>
        <b class="text-white text-fs-24 leading-none tabular-nums">
          <span class="inline-block min-w-[2ch] text-center">{{ roundDisplay }}</span>
          <small class="text-fs-10 text-sky"
            >{{ strings.game.roundSeparator }}{{ game?.totalRounds }}</small
          >
        </b>
      </HudPill>
      <SquareIconButton
        :active="playersOpen"
        :label="strings.game.togglePlayers"
        @click="playersOpen = !playersOpen"
      >
        <Users />
      </SquareIconButton>
      <SquareIconButton
        :active="chatOpen"
        :label="strings.game.toggleChat"
        @click="chatOpen = !chatOpen"
      >
        <MessageSquare />
      </SquareIconButton>
      <SquareIconButton
        v-if="showTools"
        :active="toolsOpen"
        :label="strings.game.toggleTools"
        @click="toolsOpen = !toolsOpen"
      >
        <Palette />
      </SquareIconButton>
    </div>

    <!-- 中：题目（画家可点击切换明文/遮罩，猜词者恒为遮罩）；单元素居中用 grid place-items-center -->
    <div class="grid min-w-0 place-items-center">
      <HudPill
        class="min-w-[16cqw] max-w-[34cqw] justify-center px-[1.2em] transition-colors"
        :class="{
          'cursor-pointer select-none hover:bg-white/15 active:bg-white/20': store.isDrawer,
        }"
        :role="store.isDrawer ? 'button' : undefined"
        :tabindex="store.isDrawer ? 0 : undefined"
        :aria-label="store.isDrawer ? strings.game.toggleAnswerVisibilityAria : undefined"
        :title="store.isDrawer ? strings.game.toggleAnswerVisibilityHint : undefined"
        @click="toggleDrawerAnswerReveal"
        @keydown.enter.prevent="toggleDrawerAnswerReveal"
        @keydown.space.prevent="toggleDrawerAnswerReveal"
      >
        <b class="flex items-center text-yellow text-fs-24 tracking-[0.16em]">{{
          displayedAnswer
        }}</b>
      </HudPill>
    </div>

    <!-- 右：倒计时 + 网络状态 + 暂停 / 设置 / 全屏 -->
    <div class="flex items-center gap-[0.5cqw]">
      <HudPill
        class="relative box-border justify-center gap-[0.3em] overflow-hidden px-[0.55em]"
        :class="{ 'bg-red': isUrgent }"
      >
        <Clock3 class="h-[2.5cqh] w-[2.5cqh] shrink-0" />
        <b class="min-w-0 text-center text-fs-24 tabular-nums">{{ secondsLeft }}</b>
        <span class="shrink-0 text-fs-10 text-sky">{{ strings.game.secondsSuffix }}</span>
        <i
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
      <!--
        暂停/恢复单按钮切换：
        - 游戏进行中（非 starting/paused）：显示暂停图标，点击暂停或请求暂停；
        - 暂停中（paused）：图标切换为继续，房主点击恢复，非房主置灰禁用；
        - 开局倒计时（starting）：不在 pausable 状态，不展示。
      -->
      <IconButton
        v-if="store.room.phase !== 'starting'"
        :disabled="store.room.phase === 'paused' && !store.isHost"
        :label="
          store.room.phase === 'paused'
            ? strings.game.resumeAria
            : store.isHost
              ? strings.game.pauseAriaHost
              : strings.game.pauseAriaGuest
        "
        @click="handlePauseToggle"
      >
        <CirclePlay v-if="store.room.phase === 'paused'" />
        <CirclePause v-else />
      </IconButton>
      <IconButton :label="strings.game.settingsAria" @click="emit('settings')">
        <Settings />
      </IconButton>
      <IconButton
        :label="isFullscreen ? strings.game.exitFullscreenAria : strings.game.enterFullscreenAria"
        @click="emit('toggle-fullscreen')"
      >
        <Minimize v-if="isFullscreen" /><Maximize v-else />
      </IconButton>
    </div>
  </header>
</template>
