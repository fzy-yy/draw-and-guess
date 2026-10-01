<!--
  原型根舞台（纯 UI 演示，不连后端）：
  复刻 App.vue 的 16:9 舞台外壳，装配真实 HUD 派生值（useGameHud）+ 本地画板历史，
  渲染唯一的「底部工具条」布局；底部悬浮切换条只负责在猜词者 / 画家两种视角间切换。
-->
<script setup lang="ts">
import { provide, ref } from 'vue'
import { useFullscreen } from '@vueuse/core'
import { APP_CONFIG } from '@draw-guess/config'
import { useGameStore } from '@/stores/game'
import { useGameHud } from '@/composables/useGameHud'
import { useShortcuts } from '@/composables/useShortcuts'
import { PROTOTYPE_GAME_KEY, type PrototypeGameContext } from './prototype-context.ts'
import { prototypeDrawing } from './prototype-drawing.ts'
import { prototypeRole, setPrototypeRole, type PrototypeRole } from './prototype-store.ts'
import PrototypeSwitcher from './PrototypeSwitcher.vue'
import VariantD from './VariantD.vue'

const store = useGameStore()
// 真实 HUD 派生值（整舞台唯一 ticker，见 useGameHud）+ 画板快捷键（本地工具切换）
const { game, secondsLeft, progress, canGuess } = useGameHud(store)
const { tool } = useShortcuts(store)
const color = ref(APP_CONFIG.drawing.defaultColor)
const width = ref(APP_CONFIG.drawing.width.default)

// 全屏目标：本组件的舞台元素（与 GameView 的全屏口径一致）
const stage = ref<HTMLElement>()
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(stage)

function changeRole(role: PrototypeRole): void {
  setPrototypeRole(role)
}

provide<PrototypeGameContext>(PROTOTYPE_GAME_KEY, {
  game,
  secondsLeft,
  progress,
  canGuess,
  tool,
  color,
  width,
  commands: prototypeDrawing.commands,
  undoneIds: prototypeDrawing.undoneIds,
  revision: prototypeDrawing.revision,
  lastSequence: prototypeDrawing.lastSequence,
  submitStroke: prototypeDrawing.submitStroke,
  submitFill: prototypeDrawing.submitFill,
  isFullscreen,
  onToggleFullscreen: () => {
    void toggleFullscreen().catch(() => {})
  },
  onOpenSettings: () => {
    // 原型不提供设置页：演示聚焦布局，设置入口只保留视觉位置
  },
})
</script>

<template>
  <!-- 视口外壳：与 App.vue 一致的黑底居中 16:9 舞台（高度让出底部给原型控制条） -->
  <div class="relative grid h-full w-full place-items-center overflow-hidden bg-black">
    <section
      ref="stage"
      class="game-stage relative aspect-video h-[min(88vh,calc(99vw*9/16))] w-[min(99vw,calc(88vh*16/9))] overflow-hidden rounded-[clamp(6px,1cqh,14px)] border-[max(1px,0.28cqh)] border-navy bg-paper shadow-float"
    >
      <VariantD />
    </section>
    <PrototypeSwitcher :role="prototypeRole" @update:role="changeRole" />
  </div>
</template>
