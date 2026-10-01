<!--
  变体 A「自由浮窗」：画布在 HUD 下方占满固定工作区；玩家、聊天、工具是互相独立的
  可拖动窗口，显示/关闭只叠在画布上，不改画布的宽高或位置。默认全部关闭，
  顶栏三个单图标按钮控制各自窗口；面板右上角 X 也能关闭，标题栏可拖动。
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useGameStore } from '@/stores/game'
import { ChatPanel, GameCanvas, GameHud, ScoreStrip } from '@/components/game'
import DraggablePanel, { type PanelPosition } from './DraggablePanel.vue'
import PrototypePanelControls from './PrototypePanelControls.vue'
import PrototypeToolPanel from './PrototypeToolPanel.vue'
import { labels } from './labels.ts'
import { usePrototypeContext } from './prototype-context.ts'

const {
  game,
  secondsLeft,
  progress,
  drawer,
  canGuess,
  tool,
  color,
  width,
  commands,
  undoneIds,
  revision,
  lastSequence,
  isFullscreen,
  submitStroke,
  submitFill,
  onToggleFullscreen,
  onOpenSettings,
} = usePrototypeContext()
const store = useGameStore()

const playersOpen = ref(false)
const chatOpen = ref(false)
const toolsOpen = ref(false)
const playersPosition = ref<PanelPosition>({ x: 1.5, y: 7 })
const chatPosition = ref<PanelPosition>({ x: 70, y: 5 })
const toolsPosition = ref<PanelPosition>({ x: 29, y: 67 })

// 离开画家视角时同步收起工具窗；切回后仍由顶栏图标显式打开。
watch(
  () => store.isDrawer,
  (isDrawer) => {
    if (!isDrawer) toolsOpen.value = false
  },
)
</script>

<template>
  <main class="relative h-full bg-paper">
    <GameHud
      class="absolute inset-x-0 top-0 z-40 h-[11%]"
      :is-fullscreen="isFullscreen"
      :game="game"
      :seconds-left="secondsLeft"
      :progress="progress"
      :drawer="drawer"
      @settings="onOpenSettings"
      @toggle-fullscreen="onToggleFullscreen"
    />

    <!-- 固定画布矩形：面板开合和拖动不会参与布局计算，所以画布从不缩放或移位。 -->
    <section
      class="absolute inset-x-[0.6cqw] top-[12.5%] bottom-[0.7cqh] z-10 overflow-hidden border-[0.3cqh] border-navy bg-white shadow-block"
    >
      <GameCanvas
        v-model:width="width"
        :round-id="game?.roundId ?? ''"
        :strokes="commands"
        :undone-stroke-ids="undoneIds"
        :last-sequence="lastSequence"
        :can-draw="store.isDrawer && store.room?.phase === 'drawing'"
        :tool="tool"
        :color="color"
        :revision="revision"
        @stroke="submitStroke"
        @fill="submitFill"
      />
    </section>

    <!-- 面板工具始终在顶栏；按钮仅切换窗口可见性，不改变下方画布的固定矩形。 -->
    <PrototypePanelControls
      v-model:players-open="playersOpen"
      v-model:chat-open="chatOpen"
      v-model:tools-open="toolsOpen"
      v-model:brush-width="width"
      :show-tools="store.isDrawer"
    />

    <!-- 浮窗层只覆盖画布；每个窗口独立显隐、可拖动、可关闭、可互相叠放置顶。 -->
    <div class="pointer-events-none absolute inset-x-[0.6cqw] top-[12.5%] bottom-[0.7cqh] z-50">
      <DraggablePanel
        v-model:open="playersOpen"
        v-model:position="playersPosition"
        :title="labels.players"
        width-class="w-[23cqw]"
        height-class="h-[62cqh]"
        appearance="window"
        motion="scale"
      >
        <div class="grid min-h-0 flex-1 overflow-hidden [&_aside]:border-0">
          <ScoreStrip />
        </div>
      </DraggablePanel>

      <DraggablePanel
        v-model:open="chatOpen"
        v-model:position="chatPosition"
        :title="labels.chat"
        width-class="w-[28cqw]"
        height-class="h-[72cqh]"
        appearance="window"
        motion="scale"
      >
        <div class="grid min-h-0 flex-1 overflow-hidden [&_aside]:border-0">
          <ChatPanel :can-guess="canGuess" />
        </div>
      </DraggablePanel>

      <DraggablePanel
        v-if="store.isDrawer"
        v-model:open="toolsOpen"
        v-model:position="toolsPosition"
        :title="labels.toolsTab"
        width-class="w-[42cqw]"
        height-class="h-[22cqh]"
        appearance="window"
        motion="from-bottom"
      >
        <PrototypeToolPanel
          v-model:tool="tool"
          v-model:color="color"
          v-model:width="width"
          layout="horizontal"
        />
      </DraggablePanel>
    </div>
  </main>
</template>
