<!--
  浮层面板壳：标题栏拖动 + 关闭按钮 + 工作区内位置夹取，显隐统一为「淡入淡出 + 缩放」。
  开关状态与位置由父组件持有（v-model:open / v-model:position）：顶栏开关与面板内关闭按钮
  写同一份 open，因此两处天然同步；位置以相对画布容器的百分比记账，刷新即重置。
  拖动只绑定标题栏，正文里的输入框、聊天滚动与画布绘制不会被抢走指针事件。
-->
<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { cn } from '@/utils/cn'
import { scaleFadeEnter, scaleFadeLeave } from '@/components/game/scale-fade.ts'
import {
  bringPanelToFront,
  registerPanelLayer,
  unregisterPanelLayer,
} from '@/components/game/floating-panel-z'

export interface PanelPosition {
  /** 面板左上角相对可视工作区（画布容器）的横向百分比。 */
  x: number
  /** 面板左上角相对可视工作区的纵向百分比。 */
  y: number
}

// 位置给对象默认值（工厂避免共享引用），父组件仍可用 v-model:position 覆盖。
const position = defineModel<PanelPosition>('position', { default: () => ({ x: 0, y: 0 }) })
const open = defineModel<boolean>('open', { required: true })

const props = withDefaults(
  defineProps<{
    /** 面板标题（来自集中文案来源）。 */
    title: string
    /** 面板尺寸类（宽 / 高，随舞台容器单位等比缩放）。 */
    widthClass?: string
    heightClass?: string
  }>(),
  { widthClass: '', heightClass: '' },
)

const panelElement = ref<HTMLElement>()
// 层级由模块级共享协调器分配，保证两个面板能互相置顶（细节与上限见 floating-panel-z.ts）。
const layer = registerPanelLayer()
onUnmounted(() => unregisterPanelLayer(layer.id))
const dragging = ref(false)

const rootClass = computed(() =>
  cn(
    'pointer-events-auto absolute flex min-h-0 flex-col overflow-hidden rounded-[0.7em] border-[0.28cqh] border-navy bg-paper/95 shadow-float',
    props.widthClass,
    props.heightClass,
  ),
)

const shellStyle = computed<Record<string, string>>(() => ({
  left: `${position.value.x}%`,
  top: `${position.value.y}%`,
  zIndex: String(layer.zIndex.value),
}))

let dragOrigin:
  | {
      pointerX: number
      pointerY: number
      positionX: number
      positionY: number
    }
  | undefined

/** 点击面板或开始拖动时置顶，避免后打开的面板被已有面板遮住。 */
function bringToFront(): void {
  bringPanelToFront(layer.id)
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
  // 夹取到工作区内：maxX/maxY 为面板左/上边可到达的极限百分比，防止被拖出画布。
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
</script>

<template>
  <Transition :css="false" @enter="scaleFadeEnter" @leave="scaleFadeLeave">
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
          :aria-label="strings.game.closePanelAria"
          :title="strings.game.closePanelAria"
          @click="open = false"
        >
          <X />
        </button>
      </header>
      <div class="grid min-h-0 flex-1 grid-rows-1 overflow-hidden">
        <slot />
      </div>
    </section>
  </Transition>
</template>
