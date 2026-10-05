<!--
  可拖动浮层外壳（S86）：把「默认停靠 → 手柄拖动 → 百分比定位 + 工作区夹取」抽成共用单点，
  画布底部工具条（CanvasToolbar）与接龙作答浮层（工单 10）共用同一实现，拖动行为只维护一处。
  外壳只负责定位与拖动：视觉与排版全部由调用方给出；手柄经默认插槽的 `drag` 绑定放置
  （工具条放在行首、作答浮层放在顶部行），不把任一宿主的排版假设固化进外壳。
  位置以相对父容器（画布工作区）的百分比记账：position 为 null 表示尚未拖动过，按 defaultClass 停靠。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PanelPosition } from '@/components/game/FloatingPanel.vue'

const position = defineModel<PanelPosition | null>('position', { default: null })

const props = withDefaults(
  defineProps<{
    /** position 为空（从未拖动过）时的默认停靠类，由宿主按自身停靠位置给出。 */
    defaultClass?: string
    /** 拖动手柄的原生 title（悬浮提示，来自 strings.a11y）。 */
    dragTitle: string
    /** 拖动手柄的无障碍名（来自 strings.a11y）。 */
    dragAria: string
  }>(),
  { defaultClass: '' },
)

const emit = defineEmits<{
  /** 指针按下（冒泡已阻断）：宿主据此决定层级，例如工具条置顶。 */
  activate: []
}>()

const root = ref<HTMLElement>()
const dragging = ref(false)
let dragOrigin:
  | {
      pointerX: number
      pointerY: number
      positionX: number
      positionY: number
    }
  | undefined

/**
 * 手柄的基础交互类：抓取光标、禁用触摸滚动与拖动中的选中态由外壳统一负责，
 * 尺寸 / 圆角 / 悬停底色等排版差异留给宿主自行附加。
 * 手柄只包一个图标，绝对居中按仓库布局规范用 `grid place-items-center`（不用 flex 居中）。
 */
const gripClass =
  'grid cursor-grab touch-none place-items-center text-muted transition-colors active:cursor-grabbing'

/** 交给宿主 `v-bind` 的手柄绑定：事件 + 无障碍名 + 基础交互类。 */
const dragProps = computed(() => ({
  class: gripClass,
  title: props.dragTitle,
  'aria-label': props.dragAria,
  onPointerdown: beginDrag,
  onPointermove: moveDrag,
  onPointerup: endDrag,
  onPointercancel: endDrag,
}))

const rootStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {}
  if (!position.value) return style
  style.left = `${position.value.x}%`
  style.top = `${position.value.y}%`
  // 拖动后必须清掉默认停靠的 bottom 与居中位移，否则 left/top 与它们叠加错位。
  style.bottom = 'auto'
  style.transform = 'none'
  return style
})

function beginDrag(event: PointerEvent): void {
  if (event.button !== 0) return
  const handle = event.currentTarget
  if (!(handle instanceof HTMLElement)) return
  event.preventDefault()
  handle.setPointerCapture(event.pointerId)
  dragging.value = true

  const panel = root.value
  // 拖动记账的工作区就是浮层的父容器（画布容器），与钳制边界同源。
  const workspace = panel?.parentElement
  if (!panel || !workspace) return

  const bounds = workspace.getBoundingClientRect()
  const panelBounds = panel.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return

  const currentX = ((panelBounds.left - bounds.left) / bounds.width) * 100
  const currentY = ((panelBounds.top - bounds.top) / bounds.height) * 100
  position.value = { x: currentX, y: currentY }
  dragOrigin = {
    pointerX: event.clientX,
    pointerY: event.clientY,
    positionX: currentX,
    positionY: currentY,
  }
}

function moveDrag(event: PointerEvent): void {
  const origin = dragOrigin
  const panel = root.value
  const workspace = panel?.parentElement
  if (!dragging.value || !origin || !panel || !workspace) return

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
  const handle = event.currentTarget
  if (handle instanceof HTMLElement && handle.hasPointerCapture(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId)
  }
  dragging.value = false
  dragOrigin = undefined
}
</script>

<template>
  <div
    ref="root"
    class="pointer-events-auto absolute select-none"
    :class="position ? undefined : props.defaultClass"
    :style="rootStyle"
    @pointerdown.stop="emit('activate')"
  >
    <slot :drag="dragProps" />
  </div>
</template>
