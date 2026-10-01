<!--
  变体 D「底部工具条」：顶栏以下的画板加黑色边框与极小边距；
  绘图工具是悬浮在画板底部的横向长条（单行、尽量薄、与工具 icon 尺寸相适应），
  由顶栏「工具」按钮开关；玩家与聊天浮层纵向撑满画布高度，贴左右两缘。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { ChatPanel, GameCanvas } from '@/components/game'
import DraggablePanel, { type PanelPosition } from './DraggablePanel.vue'
import PlayersPanel from './PlayersPanel.vue'
import PrototypeTopBar from './PrototypeTopBar.vue'
import ToolBarBody from './ToolBarBody.vue'
import { labels } from './labels.ts'
import { usePrototypeContext } from './prototype-context.ts'

const {
  game,
  secondsLeft,
  progress,
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

const canDraw = computed(() => store.isDrawer && store.room?.phase === 'drawing')

const toolsOpen = ref(true)
const playersOpen = ref(true)
const chatOpen = ref(true)
// 玩家贴左缘、聊天贴右缘（右侧留出面板宽度）；高度由 h-full 撑满画布
const playersPosition = ref<PanelPosition>({ x: 0, y: 0 })
const chatPosition = ref<PanelPosition>({ x: 76, y: 0 })
</script>

<template>
  <main class="relative flex h-full flex-col bg-paper">
    <PrototypeTopBar
      v-model:players-open="playersOpen"
      v-model:chat-open="chatOpen"
      v-model:tools-open="toolsOpen"
      :game="game"
      :seconds-left="secondsLeft"
      :progress="progress"
      :is-fullscreen="isFullscreen"
      :show-tools="store.isDrawer"
      @settings="onOpenSettings"
      @toggle-fullscreen="onToggleFullscreen"
    />

    <!-- 画板：黑色边框 + 圆角（与面板圆角一致）+ 极小边距，浮层与底部工具条都在其内定位 -->
    <div class="min-h-0 flex-1 p-[0.7cqh_0.7cqw]">
      <div
        class="relative h-full overflow-hidden rounded-[0.7em] border-[0.35cqh] border-black bg-white"
      >
        <GameCanvas
          v-model:width="width"
          :round-id="game?.roundId ?? ''"
          :strokes="commands"
          :undone-stroke-ids="undoneIds"
          :last-sequence="lastSequence"
          :can-draw="canDraw"
          :tool="tool"
          :color="color"
          :revision="revision"
          @stroke="submitStroke"
          @fill="submitFill"
        />

        <DraggablePanel
          v-model:open="playersOpen"
          v-model:position="playersPosition"
          :title="labels.players"
          width-class="w-[10cqw]"
          height-class="h-full"
          appearance="window"
        >
          <PlayersPanel />
        </DraggablePanel>

        <DraggablePanel
          v-model:open="chatOpen"
          v-model:position="chatPosition"
          :title="labels.chat"
          width-class="w-[24cqw]"
          height-class="h-full"
          appearance="window"
        >
          <div class="grid min-h-0 flex-1 overflow-hidden [&_aside]:border-0">
            <ChatPanel :can-guess="canGuess" />
          </div>
        </DraggablePanel>

        <!-- 底部横向工具长条：浮在画板上、尽量薄，由顶栏「工具」按钮开关 -->
        <div
          v-if="store.isDrawer && toolsOpen"
          class="absolute bottom-[1.2cqh] left-1/2 z-40 -translate-x-1/2"
        >
          <ToolBarBody :can-draw="canDraw" />
        </div>
      </div>
    </div>
  </main>
</template>
