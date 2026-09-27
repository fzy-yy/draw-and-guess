<!--
  对局顶栏 HUD（从 GameView.vue 拆出的子组件）：
  回合数、当前画家、答案、计时器、网络状态与暂停/设置/全屏操作。
  该组件只读 store 的公开状态；HUD 派生值（计时/进度/画家/答案）由父组件经 props 传入，
  整局的 ticker 只在 GameView 持有。仅把「设置」「全屏」作为事件抛给父组件。
  答案区不渲染标签行（如「你的题目」）：答案文字本身语义自明，避免顶栏文字冗余。
-->
<script setup lang="ts">
import { Clock3, CirclePause, CirclePlay, Settings, Maximize, Minimize } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { strings } from '@draw-guess/strings'
import { playInteractionSound } from '@/audio'
import type { GameView, RoomMember } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import AvatarImage from '@/components/common/AvatarImage.vue'
import IconButton from '@/components/common/IconButton.vue'
import NetworkStatusButton from '@/components/common/NetworkStatusButton.vue'
import HudPill from '@/components/game/HudPill.vue'

// 对局 HUD 派生值（计时/进度/当前画家/答案）由父组件 GameView 统一计算后经 props 下发，
// 整局只保留一个 ticker，避免 GameHud/PhaseOverlay 各自开启 200ms 定时器造成重复刷新。
const props = defineProps<{
  /** 是否处于全屏：用于切换全屏/退出全屏图标与无障碍标签。 */
  isFullscreen: boolean
  /** 对局视图（回合/答案/遮罩等），由 useGameHud 派生。 */
  game: GameView | undefined
  /** 当前阶段剩余秒数。 */
  secondsLeft: number
  /** 当前阶段剩余进度（0～1），供进度条 scaleX。 */
  progress: number
  /** 当前画家成员信息。 */
  drawer: RoomMember | undefined
}>()
const emit = defineEmits<{
  /** 打开对局内设置弹窗（父组件维护弹窗开关）。 */
  settings: []
  /** 切换全屏（父组件操作全屏 API）。 */
  'toggle-fullscreen': []
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

/** 最后 10 秒（且未归零）进入紧急样式：计时器底色与进度条同步变红。 */
const isUrgent = computed(
  () => props.secondsLeft <= store.config.game.warningSeconds && props.secondsLeft > 0,
)

/** 单按钮处理暂停与恢复切换：暂停时房主点击恢复，运行中点击暂停或请求暂停 */
function handlePauseToggle(): void {
  if (store.room?.phase === 'paused') {
    if (store.isHost) {
      void store.resume()
    }
  } else {
    void store.pause(store.isHost ? strings.game.pauseReasonHost : strings.game.pauseReasonGuest)
  }
}

/**
 * 画家答案显示状态：
 * 默认遵循用户设置（store.settings.drawerDefaultReveal，默认 false 和猜词玩家一致）；
 * 画家可点击答案胶囊底框切换明文/遮罩，以便查看猜词玩家的逐字提示进度。
 */
const drawerRevealed = ref(store.settings.drawerDefaultReveal)

// 题目变更或设置变更时，按最新设置重置显隐状态
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

/**
 * 猜词者视角的结构化提示：服务端按揭示节奏下发的首条；揭示前为空串（模板显示占位）。
 */
const revealedHint = computed(() => props.game?.revealedHints?.[0] || '')

/**
 * 提示展示内容：
 * - 画家在「画家模式」（显示答案）：完整显示词条提示（服务端 `wordHint`，hint 优先、空回退 category），
 *   与答案一同明文；
 * - 画家切到「猜词者模式」，或猜词者本人：只显示按时间逐渐披露的 `revealedHint`。
 * 两条分支同源（hint 优先、空回退 category），不会出现一侧分类、一侧 hint 的不一致（见 ADR-0032）。
 */
const displayedHint = computed(() => {
  if (store.isDrawer && drawerRevealed.value) {
    return props.game?.wordHint || revealedHint.value || ''
  }
  return revealedHint.value || ''
})

/** 答案区展示文本：画家按显隐状态决定明文或遮罩，猜词者恒为遮罩 */
const displayedAnswer = computed(() => {
  if (store.isDrawer) {
    if (drawerRevealed.value && props.game?.answer) {
      return props.game.answer
    }
    return props.game?.answerMask || strings.game.awaitingWord
  }
  return props.game?.answerMask || strings.game.awaitingWord
})
</script>

<template>
  <!-- 顶栏 HUD：回合数、当前画家、答案、计时器、网络状态与暂停按钮 -->
  <header
    v-if="store.room"
    class="col-span-full grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_minmax(8.6cqw,auto)_auto_auto] items-center gap-[1.1em] overflow-hidden border-b-[0.45cqh] border-yellow bg-navy px-[1.2cqw] text-white"
  >
    <!-- 回合指示：胶囊底衬（与计时器一致），横排「ROUND 1 / 4」 -->
    <HudPill>
      <!-- 回合英文标签属装饰性说明。 -->
      <span class="text-sky text-fs-12">{{ strings.game.roundLabel }}</span>
      <b class="text-white text-fs-24 leading-none tabular-nums">
        <!-- 当前回合固定 2ch 宽：两位数回合（如 9→10）不会挤动顶栏后续栏目 -->
        <span class="inline-block min-w-[2ch] text-center">{{ roundDisplay }}</span>
        <small class="text-fs-10 text-sky"
          >{{ strings.game.roundSeparator }}{{ game?.totalRounds }}</small
        >
      </b>
    </HudPill>
    <!-- 当前画家：胶囊底衬 + 头像 + 昵称 -->
    <HudPill class="max-w-[20cqw]">
      <AvatarImage
        class="h-[4.6cqh] w-[4.6cqh]"
        :avatar-id="drawer?.avatarId"
        :label="strings.game.drawerAvatarAria"
      />
      <span class="min-w-0 flex flex-col text-sky text-fs-10">
        {{ strings.game.drawerLabel }}
        <b class="overflow-hidden text-ellipsis whitespace-nowrap text-white text-fs-24">{{
          drawer?.nickname || strings.game.drawerPending
        }}</b>
      </span>
    </HudPill>
    <!-- 答案展示：提示行在上、答案（或遮罩）行在下。
         底衬统一复用 HudPill 胶囊底衬（与计时器底框一致）；
         猜词玩家与画家视觉底框一致，画家额外支持点击切换明文/遮罩（以便观察猜词玩家逐字提示进度）。 -->
    <HudPill
      class="justify-self-center min-w-[16cqw] flex-col justify-center px-[1.2em] py-[0.3cqh] h-auto min-h-[6.5cqh] transition-colors"
      :class="{
        'cursor-pointer hover:bg-white/15 active:bg-white/20 select-none': store.isDrawer,
      }"
      :role="store.isDrawer ? 'button' : undefined"
      :tabindex="store.isDrawer ? 0 : undefined"
      :aria-label="store.isDrawer ? strings.game.toggleAnswerVisibilityAria : undefined"
      :title="store.isDrawer ? strings.game.toggleAnswerVisibilityHint : undefined"
      @click="toggleDrawerAnswerReveal"
      @keydown.enter.prevent="toggleDrawerAnswerReveal"
      @keydown.space.prevent="toggleDrawerAnswerReveal"
    >
      <!--
        结构化提示区（位于答案上方）：提示来源统一为词条 hint（空回退 category）。
        画家模式完整显示提示与答案；画家切到猜词者模式、或猜词者本人，则按时间逐渐披露
        （未揭示时显示占位符，揭示后显示同一条提示）。
      -->
      <p
        v-if="
          store.room?.settings.structuredHintsEnabled &&
          (props.game?.answerMask || props.game?.answer)
        "
        class="flex min-h-[2.2cqh] items-center gap-[0.35em] text-fs-10 font-bold leading-[1.3] text-sky"
        role="status"
      >
        <span class="rounded-[0.35em] bg-yellow px-[0.4em] py-[0.05cqh] font-bold text-navy">{{
          strings.game.hintBadgeLabel
        }}</span>
        <span
          class="min-w-0 max-w-[12cqw] truncate"
          :class="displayedHint ? 'text-sky' : 'text-sky/70 tracking-[0.12em]'"
          :title="displayedHint || strings.game.hintUnrevealed"
        >
          {{ displayedHint || strings.game.hintUnrevealed }}
        </span>
      </p>
      <b class="min-h-[3.8cqh] flex items-center text-yellow text-fs-24 tracking-[0.16em]">{{
        displayedAnswer
      }}</b>
    </HudPill>
    <!-- 计时器：剩余秒数 + 进度条；底部胶囊底衬与回合/画家指示统一（HudPill）；最后 10 秒进入紧急样式 -->
    <HudPill
      class="relative box-border justify-center gap-[0.3em] overflow-hidden px-[0.55em]"
      :class="{ 'bg-red': isUrgent }"
    >
      <Clock3 class="h-[2.5cqh] w-[2.5cqh] shrink-0" /><b
        class="min-w-0 text-center text-fs-24 tabular-nums"
        >{{ secondsLeft }}</b
      ><span class="shrink-0 text-fs-10 text-sky">{{ strings.game.secondsSuffix }}</span>
      <i
        class="absolute bottom-0 left-0 h-[0.45cqh] w-full origin-left"
        :class="isUrgent ? 'bg-yellow' : 'bg-green'"
        :style="{ transform: `scaleX(${progress})` }"
      ></i>
    </HudPill>
    <!-- 网络状态：统一复用 NetworkStatusButton 图标按钮展示，悬浮查看连接详情（与各顶栏一致） -->
    <NetworkStatusButton
      :connected="store.connected"
      :latency="store.latency"
      :connection-label="store.connectionLabel"
      :latency-good-ms="store.config.network.latencyGoodMs"
    />
    <!-- 右上角操作组：暂停/继续、设置、进入或退出全屏。 -->
    <div class="flex items-center gap-[0.45em]">
      <!--
        暂停/恢复单按钮切换：
        - 游戏进行中（非 starting/paused）：显示暂停图标（CirclePause），点击暂停或请求暂停；
        - 游戏暂停中（paused）：图标切换为继续（CirclePlay），房主点击恢复对局，非房主置灰禁用；
        - 开局倒计时阶段（starting）：不在 pausable 状态，不展示。
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
