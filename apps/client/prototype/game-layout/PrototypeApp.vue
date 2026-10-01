<!--
  原型根舞台（纯 UI 演示，不连后端）：
  复刻 App.vue 的 16:9 舞台外壳，装配真实 HUD 派生值（useGameHud）+ 本地画板历史，
  按 ?variant= 渲染三个布局变体之一；底部悬浮切换条与键盘 ←/→ 负责变体切换，
  切换条上的「视角」用于对比猜词者 / 画家两种角色的布局与工具栏状态。
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useFullscreen } from '@vueuse/core'
import { APP_CONFIG } from '@draw-guess/config'
import { useGameStore } from '@/stores/game'
import { useGameHud } from '@/composables/useGameHud'
import { useShortcuts } from '@/composables/useShortcuts'
import {
  PROTOTYPE_GAME_KEY,
  type PrototypeGameContext,
  type PrototypeVariantKey,
} from './prototype-context.ts'
import { prototypeDrawing } from './prototype-drawing.ts'
import { prototypeRole, setPrototypeRole, type PrototypeRole } from './prototype-store.ts'
import PrototypeSwitcher from './PrototypeSwitcher.vue'
import VariantDocked from './VariantDocked.vue'
import VariantOverlay from './VariantOverlay.vue'
import VariantDock from './VariantDock.vue'

const VARIANT_ORDER: PrototypeVariantKey[] = ['A', 'B', 'C']

/** 从 URL 读取初始变体（?variant=A|B|C，缺省 A）。 */
function readVariantFromUrl(): PrototypeVariantKey {
  const raw = new URLSearchParams(location.search).get('variant')?.toUpperCase()
  return raw === 'B' || raw === 'C' ? raw : 'A'
}

const store = useGameStore()
// 真实 HUD 派生值（整舞台唯一 ticker，见 useGameHud）+ 画板快捷键（本地工具切换）
const { game, secondsLeft, progress, canGuess, drawer } = useGameHud(store)
const { tool } = useShortcuts(store)
const color = ref(APP_CONFIG.drawing.defaultColor)
const width = ref(APP_CONFIG.drawing.width.default)
const variant = ref<PrototypeVariantKey>(readVariantFromUrl())

// 全屏目标：本组件的舞台元素（与 GameView 的全屏口径一致）
const stage = ref<HTMLElement>()
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(stage)

function selectVariant(next: PrototypeVariantKey): void {
  variant.value = next
  // 用 URLSearchParams + location 拼回地址，避免依赖未登记的 URL 全局
  const params = new URLSearchParams(location.search)
  params.set('variant', next)
  history.replaceState(null, '', `${location.pathname}?${params.toString()}`)
}

function cycleVariant(step: number): void {
  const index = VARIANT_ORDER.indexOf(variant.value)
  const next = VARIANT_ORDER[(index + step + VARIANT_ORDER.length) % VARIANT_ORDER.length] ?? 'A'
  selectVariant(next)
}

/** 键盘 ←/→ 切换变体；输入框等可编辑元素拥有键盘优先权（与 useShortcuts 同一约定）。 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const element = event.target as { tagName?: string; isContentEditable?: boolean } | null
  if (
    element?.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName ?? '')
  )
    return
  cycleVariant(event.key === 'ArrowRight' ? 1 : -1)
}
onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))

function changeRole(role: PrototypeRole): void {
  setPrototypeRole(role)
}

provide<PrototypeGameContext>(PROTOTYPE_GAME_KEY, {
  game,
  secondsLeft,
  progress,
  drawer,
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
  <!-- 视口外壳：与 App.vue 一致的黑底居中 16:9 舞台 -->
  <div class="relative grid h-full w-full place-items-center overflow-hidden bg-black">
    <section
      ref="stage"
      class="game-stage relative aspect-video h-[min(99vh,calc(99vw*9/16))] w-[min(99vw,calc(99vh*16/9))] overflow-hidden rounded-[clamp(6px,1cqh,14px)] border-[max(1px,0.28cqh)] border-navy bg-paper shadow-float"
    >
      <VariantDocked v-if="variant === 'A'" />
      <VariantOverlay v-else-if="variant === 'B'" />
      <VariantDock v-else />
    </section>
    <PrototypeSwitcher
      :variant="variant"
      :role="prototypeRole"
      @prev="cycleVariant(-1)"
      @next="cycleVariant(1)"
      @update:role="changeRole"
    />
  </div>
</template>
