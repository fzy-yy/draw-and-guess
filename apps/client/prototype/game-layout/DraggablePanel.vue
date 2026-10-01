<!--
  可拖动的原型面板窗口：所有布局变体共用交互骨架，但分别决定大小、位置、外观与入场方向。
  面板状态由调用者持有；关闭按钮与顶栏图标都写同一个 open ref，所以两处能互相同步。
  拖动只绑定标题栏，正文里的输入框、聊天滚动和画布绘制不会被抢走指针事件。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { cn } from '@/utils/cn'
import { labels } from './labels.ts'

export interface PanelPosition {
  /** 面板左上角相对于可视工作区的横向百分比。 */
  x: number
  /** 面板左上角相对于可视工作区的纵向百分比。 */
  y: number
}

type PanelMotion = 'scale' | 'from-left' | 'from-right' | 'from-bottom'
type PanelAppearance = 'window' | 'drawer' | 'compact'
type TransitionElement = globalThis.Element

const open = defineModel<boolean>('open', { required: true })
const position = defineModel<PanelPosition>('position', { required: true })

const props = withDefaults(
  defineProps<{
    title: string
    widthClass: string
    heightClass: string
    motion?: PanelMotion
    appearance?: PanelAppearance
  }>(),
  { motion: 'scale', appearance: 'window' },
)

const panelElement = ref<HTMLElement>()
const zIndex = ref(35)
const dragging = ref(false)
const rootClass = computed(() =>
  cn(
    'absolute flex min-h-0 flex-col overflow-hidden border-[0.28cqh] pointer-events-auto',
    props.widthClass,
    props.heightClass,
    props.appearance === 'window' && 'rounded-[0.7em] border-navy bg-paper/95 shadow-float',
    props.appearance === 'drawer' && 'rounded-[0.45em] border-yellow bg-paper/98 shadow-block',
    props.appearance === 'compact' && 'rounded-[0.9em] border-blue bg-white/95 shadow-float',
  ),
)

let highestZIndex = 35
let dragOrigin:
  | {
      pointerX: number
      pointerY: number
      positionX: number
      positionY: number
    }
  | undefined

/** 点击窗口或开始拖动时置顶，避免后打开的面板被已有面板遮住。 */
function bringToFront(): void {
  highestZIndex += 1
  zIndex.value = highestZIndex
}

function beginDrag(event: PointerEvent): void {
  if (event.button !== 0) return
  // 图标点击的原始 target 往往是 SVG 子节点；检查完整事件路径，避免把关闭按钮误判成拖动手柄。
  if (
    event
      .composedPath()
      .some((target) => target instanceof HTMLElement && target.tagName === 'BUTTON')
  )
    return
  const header = event.currentTarget
  if (!(header instanceof HTMLElement)) return
  event.preventDefault()
  header.setPointerCapture(event.pointerId)
  bringToFront()
  dragging.value = true
  dragOrigin = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    positionX: position.value.x,
    positionY: position.value.y,
  }
}

function moveDrag(event: PointerEvent): void {
  const origin = dragOrigin
  const panel = panelElement.value
  const workspace = panel?.parentElement
  if (!origin || !panel || !workspace) return

  const bounds = workspace.getBoundingClientRect()
  const panelBounds = panel.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  const deltaX = ((event.clientX - origin.pointerX) / bounds.width) * 100
  const deltaY = ((event.clientY - origin.pointerY) / bounds.height) * 100
  const maxX = Math.max(0, 100 - (panelBounds.width / bounds.width) * 100)
  const maxY = Math.max(0, 100 - (panelBounds.height / bounds.height) * 100)
  position.value = {
    x: Math.max(0, Math.min(maxX, origin.positionX + deltaX)),
    y: Math.max(0, Math.min(maxY, origin.positionY + deltaY)),
  }
}

function endDrag(event: PointerEvent): void {
  const header = event.currentTarget
  if (header instanceof HTMLElement && header.hasPointerCapture(event.pointerId)) {
    header.releasePointerCapture(event.pointerId)
  }
  dragging.value = false
  dragOrigin = undefined
}

/** 不引入动效依赖：WAAPI 让三个布局复用同一动画接口、各自选择不同入场方向。 */
function motionTransform(): string {
  switch (props.motion) {
    case 'from-left':
      return 'translateX(-2.5cqw) scale(0.98)'
    case 'from-right':
      return 'translateX(2.5cqw) scale(0.98)'
    case 'from-bottom':
      return 'translateY(2.5cqh) scale(0.98)'
    case 'scale':
      return 'scale(0.92)'
  }
}

function enter(element: TransitionElement, done: () => void): void {
  const animation = element.animate(
    [
      { opacity: 0, transform: motionTransform() },
      { opacity: 1, transform: 'translate(0, 0) scale(1)' },
    ],
    { duration: 210, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
  )
  void animation.finished.then(done, done)
}

function leave(element: TransitionElement, done: () => void): void {
  const animation = element.animate(
    [
      { opacity: 1, transform: 'translate(0, 0) scale(1)' },
      { opacity: 0, transform: motionTransform() },
    ],
    { duration: 160, easing: 'ease-in' },
  )
  void animation.finished.then(done, done)
}
</script>

<template>
  <Transition :css="false" @enter="enter" @leave="leave">
    <section
      v-if="open"
      ref="panelElement"
      :class="rootClass"
      :style="{ left: `${position.x}%`, top: `${position.y}%`, zIndex }"
      @pointerdown="bringToFront"
    >
      <header
        class="flex shrink-0 touch-none cursor-grab items-center gap-[0.6em] border-b-[0.18cqh] border-line px-[0.75em] py-[0.55cqh] active:cursor-grabbing"
        :class="dragging ? 'bg-sky' : 'bg-white/70'"
        @pointerdown="beginDrag"
        @pointermove="moveDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
      >
        <span class="min-w-0 flex-1 truncate text-fs-12 font-bold text-navy">{{ title }}</span>
        <button
          type="button"
          class="grid h-[3.4cqh] w-[3.4cqh] shrink-0 place-items-center rounded-full bg-line text-navy hover:bg-sky"
          :aria-label="labels.closePanel"
          :title="labels.closePanel"
          @click="open = false"
        >
          <X />
        </button>
      </header>
      <div class="grid min-h-0 flex-1 overflow-hidden">
        <slot />
      </div>
    </section>
  </Transition>
</template>
