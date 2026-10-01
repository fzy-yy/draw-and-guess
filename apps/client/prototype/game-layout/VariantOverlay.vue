<!--
  变体 B「边缘抽屉」：画布保持同一个最大矩形；玩家和聊天以大尺寸边缘抽屉叠在画布上，
  工具窗沿底边滑入。窗口入场方向各不相同；动画结束后可从标题栏拖离边缘到任意位置，
  顶栏图标与面板内关闭按钮都可切换显隐，开合不会触发网格重排。
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
const playersPosition = ref<PanelPosition>({ x: 0.5, y: 3 })
const chatPosition = ref<PanelPosition>({ x: 71, y: 4 })
const toolsPosition = ref<PanelPosition>({ x: 16, y: 72 })

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

    <!-- 画布矩形与变体 A 完全同尺寸；抽屉仅覆盖其表面，不挤压、不拉伸画布。 -->
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
        height-class="h-[70cqh]"
        appearance="drawer"
        motion="from-left"
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
        height-class="h-[68cqh]"
        appearance="drawer"
        motion="from-right"
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
        width-class="w-[68cqw]"
        height-class="h-[20cqh]"
        appearance="drawer"
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
