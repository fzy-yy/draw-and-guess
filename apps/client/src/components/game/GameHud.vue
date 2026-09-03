<!--
  对局顶栏 HUD（从 GameView.vue 拆出的子组件）：
  回合数、当前画家、答案、计时器、网络状态与暂停/设置/全屏操作。
  该组件只读 store 的公开状态；HUD 派生值（计时/进度/画家/答案）由父组件经 props 传入，
  整局的 ticker 只在 GameView 持有。仅把「设置」「全屏」作为事件抛给父组件。
-->
<script setup lang="ts">
import { Clock3, CirclePause, CirclePlay, Settings, Maximize, Minimize } from 'lucide-vue-next'
import { computed } from 'vue'
import { strings } from '@draw-guess/strings'
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
</script>

<template>
  <!-- 顶栏 HUD：回合数、当前画家、答案、计时器、网络状态与暂停按钮 -->
  <header
    v-if="store.room"
    class="col-span-full grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_minmax(8.6cqw,auto)_auto_auto] items-center gap-[1.1em] overflow-hidden border-b-[0.45cqh] border-yellow bg-navy px-[1.2cqw] text-white"
  >
    <!-- 回合指示：胶囊底衬（与计时器一致），横排「ROUND 1 / 4」 -->
    <HudPill>
      <span class="text-sky text-[0.65em]">{{ strings.game.roundLabel }}</span>
      <b class="text-white text-[1.6em] leading-none tabular-nums">
        <!-- 当前回合固定 2ch 宽：两位数回合（如 9→10）不会挤动顶栏后续栏目 -->
        <span class="inline-block min-w-[2ch] text-center">{{ roundDisplay }}</span>
        <small class="text-[0.5em] text-sky">/ {{ game?.totalRounds }}</small>
      </b>
    </HudPill>
    <!-- 当前画家指示：胶囊底衬，头像 + 「当前画家/昵称」两行 -->
    <HudPill>
      <AvatarImage
        class="h-[4.6cqh] w-[4.6cqh]"
        :avatar-id="drawer?.avatarId"
        :label="strings.game.drawerAvatarAria"
      />
      <span class="min-w-0 flex flex-col text-sky text-[0.62em]">
        {{ strings.game.drawerLabel }}
        <b class="overflow-hidden text-ellipsis whitespace-nowrap text-white text-[1.5em]">{{
          drawer?.nickname || strings.game.drawerPending
        }}</b>
      </span>
    </HudPill>
    <!-- 答案展示：画家看自己的题目，猜词者看遮罩；猜词者额外可见已揭示的结构化提示 -->
    <div class="justify-self-center min-w-[16cqw] flex flex-col items-center">
      <span class="text-sky text-[0.6em]">{{
        store.isDrawer && game?.answer ? strings.game.yourWord : strings.game.guessPrompt
      }}</span
      ><b class="min-h-[3.8cqh] flex items-center text-yellow text-[1.45em] tracking-[0.16em]">{{
        store.isDrawer && game?.answer ? game.answer : game?.answerMask || strings.game.awaitingWord
      }}</b>
      <!--
        结构化提示区：服务端每回合对词条 hints 洗牌后按房间规则的时机逐条揭示，
        这里只渲染随机选定的首条（全体猜词者一致）；未揭示时不渲染、不占位。
        画家已知答案，不重复展示提示。
      -->
      <p
        v-if="!store.isDrawer && game?.revealedHints?.length"
        class="flex min-h-[2.2cqh] items-center gap-[0.35em] rounded-[0.5em] bg-white/10 px-[0.6em] py-[0.15cqh] text-[0.62em] font-bold leading-[1.3] text-sky"
        role="status"
      >
        <span class="rounded-[0.35em] bg-yellow px-[0.4em] py-[0.05cqh] font-black text-navy">{{
          strings.game.hintBadgeLabel
        }}</span>
        <span class="min-w-0 flex-1 truncate" :title="game!.revealedHints![0]">{{
          game!.revealedHints![0]
        }}</span>
      </p>
    </div>
    <!-- 计时器：剩余秒数 + 进度条；底部胶囊底衬与回合/画家指示统一（HudPill）；最后 10 秒进入紧急样式 -->
    <HudPill
      class="relative box-border justify-center gap-[0.3em] overflow-hidden px-[0.55em]"
      :class="{
        'bg-red!': secondsLeft <= store.config.game.warningSeconds && secondsLeft > 0,
      }"
    >
      <Clock3 class="h-[2.5cqh] w-[2.5cqh] shrink-0" /><b
        class="min-w-0 text-center text-[1.65em] tabular-nums"
        >{{ secondsLeft }}</b
      ><span class="shrink-0 text-[0.6em] text-sky">{{ strings.game.secondsSuffix }}</span>
      <i
        class="absolute bottom-0 left-0 h-[0.45cqh] w-full bg-green origin-[left]"
        :class="{
          'bg-yellow!': secondsLeft <= store.config.game.warningSeconds && secondsLeft > 0,
        }"
        :style="{ transform: `scaleX(${progress})` }"
      ></i>
    </HudPill>
    <!-- 网络状态：统一复用 NetworkStatusButton 图标按钮展示，悬浮查看连接详情（与各顶栏一致） -->
    <NetworkStatusButton />
    <!-- 右上角操作组：暂停/继续、设置、进入或退出全屏。 -->
    <div class="flex items-center gap-[0.45em]">
      <!--
        暂停/请求暂停按钮：开局倒计时阶段不可暂停（服务端亦不在合法转换白名单内），故不展示。
        暂停阶段按钮保持可见但禁用：暂停已生效，重复请求只会被服务端拒绝（INVALID_PHASE），
        但直接隐藏会让成员侧顶栏在暂停瞬间“少一个按钮”，看起来像界面跳变（标注截图中的 bug）。
        房主在暂停阶段的继续操作由旁边单独的恢复按钮承担。
      -->
      <IconButton
        v-if="store.room.phase !== 'starting'"
        :disabled="store.room.phase === 'paused'"
        :label="store.isHost ? strings.game.pauseAriaHost : strings.game.pauseAriaGuest"
        @click="
          store.pause(store.isHost ? strings.game.pauseReasonHost : strings.game.pauseReasonGuest)
        "
      >
        <CirclePause />
      </IconButton>
      <IconButton
        v-if="store.isHost && store.room.phase === 'paused'"
        :label="strings.game.resumeAria"
        @click="store.resume"
      >
        <CirclePlay />
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
