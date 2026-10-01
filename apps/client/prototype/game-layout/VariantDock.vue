<!--
  变体 C「紧凑窗口」：相同的固定最大画布上叠放三个尺寸克制的独立浮窗，
  窗口之间留出更多画面空白；工具面板采用竖向图标/色板组织，适合窄而高的窗口。
  顶栏图标逐个切换窗口，窗口本身可拖动、置顶和关闭，显隐仅改变覆盖层，不影响画布。
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
const playersPosition = ref<PanelPosition>({ x: 2, y: 10 })
const chatPosition = ref<PanelPosition>({ x: 68, y: 8 })
const toolsPosition = ref<PanelPosition>({ x: 37, y: 33 })

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

    <!-- 全变体唯一的画布矩形：所有浮窗都在 z 轴覆盖，不参与尺寸分配。 -->
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

    <PrototypePanelControls
      v-model:players-open="playersOpen"
      v-model:chat-open="chatOpen"
      v-model:tools-open="toolsOpen"
      v-model:brush-width="width"
      :show-tools="store.isDrawer"
    />

    <div class="pointer-events-none absolute inset-x-[0.6cqw] top-[12.5%] bottom-[0.7cqh] z-50">
      <DraggablePanel
        v-model:open="playersOpen"
        v-model:position="playersPosition"
        :title="labels.players"
        width-class="w-[24cqw]"
        height-class="h-[48cqh]"
        appearance="compact"
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
        width-class="w-[30cqw]"
        height-class="h-[58cqh]"
        appearance="compact"
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
        width-class="w-[28cqw]"
        height-class="h-[42cqh]"
        appearance="compact"
        motion="scale"
      >
        <PrototypeToolPanel
          v-model:tool="tool"
          v-model:color="color"
          v-model:width="width"
          layout="vertical"
        />
      </DraggablePanel>
    </div>
  </main>
</template>
