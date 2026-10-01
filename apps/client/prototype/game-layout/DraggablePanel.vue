<!--
  可拖动的原型面板窗口：标题栏拖动 + 关闭，显隐统一为「淡入淡出 + 轻微缩放」。
  面板状态由调用者持有；顶栏开关与面板内关闭按钮都写同一个 open ref，所以两处能互相同步。
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

type PanelAppearance = 'window' | 'hud'
type TransitionElement = globalThis.Element

const open = defineModel<boolean>('open', { required: true })
const position = defineModel<PanelPosition>('position')

const props = withDefaults(
  defineProps<{
    title: string
    /** 面板尺寸类（宽 / 高，随舞台容器单位等比缩放）。 */
    widthClass?: string
    heightClass?: string
    /** 外观：window 不透明白卡 / hud 半透明纸感。 */
    appearance?: PanelAppearance
  }>(),
  { widthClass: '', heightClass: '', appearance: 'window' },
)

const panelElement = ref<HTMLElement>()
const zIndex = ref(35)
const dragging = ref(false)

const appearanceClass = computed(() =>
  props.appearance === 'hud'
    ? 'border-white/70 bg-white/55 rounded-[0.7em] shadow-float backdrop-blur-[0.35cqh]'
    : 'border-navy bg-paper/95 rounded-[0.7em] shadow-float',
)

const rootClass = computed(() =>
  cn(
    'absolute flex min-h-0 flex-col overflow-hidden border-[0.28cqh] pointer-events-auto',
    props.widthClass,
    props.heightClass,
    appearanceClass.value,
  ),
)

const shellStyle = computed<Record<string, string>>(() => ({
  left: `${position.value?.x ?? 0}%`,
  top: `${position.value?.y ?? 0}%`,
  zIndex: String(zIndex.value),
}))

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
    positionX: position.value?.x ?? 0,
    positionY: position.value?.y ?? 0,
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

/**
 * 统一显隐动画：淡入淡出 + 轻微缩放（不使用 WAAPI 之外的方向位移，
 * 保证所有面板的进出场手感一致）。css=false 让 Transition 完全交给 WAAPI。
 */
function enter(element: TransitionElement, done: () => void): void {
  const animation = element.animate(
    [
      { opacity: 0, transform: 'scale(0.94)' },
      { opacity: 1, transform: 'scale(1)' },
    ],
    { duration: 180, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
  )
  void animation.finished.then(done, done)
}

function leave(element: TransitionElement, done: () => void): void {
  const animation = element.animate(
    [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(0.94)' },
    ],
    { duration: 140, easing: 'ease-in' },
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
      :style="shellStyle"
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
