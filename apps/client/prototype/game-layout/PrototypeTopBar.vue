<!--
  原型顶栏（替代生产 GameHud，按评审要求裁剪）：
  - 删掉「当前画家」信息块（玩家面板已能看出谁在作画）；
  - 把面板开关按钮（玩家 / 聊天 / 工具）并入顶栏左侧（不再浮在画布左上角）；
  - 去掉结构化提示区，栏高相应压低；保留回合、题目、倒计时、网络状态、设置与全屏；
  - 整体沿用生产 HUD 的藏青底 + 黄描边 + 白字视觉。
-->
<script setup lang="ts">
import { computed } from 'vue'
import {
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
import { useGameStore } from '@/stores/game'
import HudPill from '@/components/game/HudPill.vue'
import IconButton from '@/components/common/IconButton.vue'
import NetworkStatusButton from '@/components/common/NetworkStatusButton.vue'
import PanelIconButton from './PanelIconButton.vue'
import { labels } from './labels.ts'

const props = defineProps<{
  /** 对局视图（回合/答案/遮罩等），由 useGameHud 派生。 */
  game: GameView | undefined
  /** 当前阶段剩余秒数。 */
  secondsLeft: number
  /** 当前阶段剩余进度（0～1），供进度条 scaleX。 */
  progress: number
  /** 是否全屏，用于切换全屏/退出全屏图标。 */
  isFullscreen: boolean
  /** 是否展示「工具」面板开关（仅画家）。 */
  showTools: boolean
}>()
const emit = defineEmits<{ settings: []; 'toggle-fullscreen': [] }>()

const playersOpen = defineModel<boolean>('playersOpen', { required: true })
const chatOpen = defineModel<boolean>('chatOpen', { required: true })
const toolsOpen = defineModel<boolean>('toolsOpen', { required: true })

const store = useGameStore()

/** 回合显示钳制到 1～总回合：服务端开局倒计时阶段 currentRound 为 0，纯展示层修正。 */
const roundDisplay = computed(() => {
  const game = props.game
  if (!game) return 0
  return Math.min(Math.max(game.currentRound, 1), game.totalRounds)
})

/** 最后 10 秒（且未归零）进入紧急样式：计时器底色与进度条同步变红。 */
const isUrgent = computed(
  () => props.secondsLeft <= store.config.game.warningSeconds && props.secondsLeft > 0,
)

/** 题目按角色展示：画家看明文，猜词者只看遮罩。 */
const displayedAnswer = computed(() => {
  if (store.isDrawer && props.game?.answer) return props.game.answer
  return props.game?.answerMask || strings.game.awaitingWord
})
</script>

<template>
  <header
    :aria-label="labels.topBarAria"
    class="grid h-[9cqh] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[1cqw] border-b-[0.45cqh] border-yellow bg-navy px-[1.2cqw] text-white"
  >
    <!-- 左：ROUND 在最左，面板开关按钮在其右侧向右排列 -->
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
      <PanelIconButton
        :active="playersOpen"
        :label="labels.togglePlayers"
        @click="playersOpen = !playersOpen"
      >
        <Users />
      </PanelIconButton>
      <PanelIconButton :active="chatOpen" :label="labels.toggleChat" @click="chatOpen = !chatOpen">
        <MessageSquare />
      </PanelIconButton>
      <PanelIconButton
        v-if="showTools"
        :active="toolsOpen"
        :label="labels.toggleTools"
        @click="toolsOpen = !toolsOpen"
      >
        <Palette />
      </PanelIconButton>
    </div>

    <!-- 中：题目 -->
    <div class="flex min-w-0 items-center justify-center">
      <HudPill class="min-w-[16cqw] max-w-[34cqw] justify-center px-[1.2em]">
        <b class="flex items-center text-yellow text-fs-24 tracking-[0.16em]">{{
          displayedAnswer
        }}</b>
      </HudPill>
    </div>

    <!-- 右：倒计时 + 网络状态 + 设置 / 全屏 -->
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
