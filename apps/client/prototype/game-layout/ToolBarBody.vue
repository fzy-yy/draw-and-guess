<!--
  底部横向绘图工具长条（自主外壳，非 DraggablePanel）：
  单行横排：工具 / 色板 / 画笔大小 / 历史操作，高度与方形工具钮相适应（尽量薄），
  悬浮在画板之上；仅「画笔大小」显示数值，其余全 icon + :title / aria。
-->
<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Brush, Eraser, PaintBucket, Pipette, RotateCcw, RotateCw, Trash2 } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { EVENTS, type ToolKind } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import { usePrototypeContext } from './prototype-context.ts'
import BrushSizeField from './BrushSizeField.vue'
import { labels } from './labels.ts'

const props = defineProps<{
  /** 是否可绘制（非画家或非作画阶段时整条置灰）。 */
  canDraw: boolean
}>()

const store = useGameStore()
const { tool, color, width } = usePrototypeContext()

const TOOLS: ReadonlyArray<{ key: ToolKind; icon: Component; label: string; aria: string }> = [
  {
    key: 'pen',
    icon: Brush,
    label: strings.game.penTool,
    aria: strings.game.penAria(store.settings.penShortcut),
  },
  {
    key: 'eraser',
    icon: Eraser,
    label: strings.game.eraserTool,
    aria: strings.game.eraserAria(store.settings.eraserShortcut),
  },
  {
    key: 'fill',
    icon: PaintBucket,
    label: strings.game.fillTool,
    aria: strings.game.fillAria(store.settings.fillShortcut),
  },
]

const HISTORY = [
  {
    key: 'undo',
    icon: RotateCcw,
    label: strings.game.undo,
    aria: strings.game.undoAria,
    event: EVENTS.drawUndo,
  },
  {
    key: 'redo',
    icon: RotateCw,
    label: strings.game.redo,
    aria: strings.game.redoAria,
    event: EVENTS.drawRedo,
  },
  {
    key: 'clear',
    icon: Trash2,
    label: strings.game.clear,
    aria: strings.game.clearAria,
    event: EVENTS.drawClear,
  },
]

const presetColors = store.config.drawing.colors
const isCustomColor = computed(
  () => !presetColors.some((paint) => color.value.toUpperCase() === paint),
)

/** 方形工具钮底座：激活态蓝底白图标。 */
function itemClass(active: boolean, disabled: boolean): string {
  return [
    'relative grid aspect-square h-[4.4cqh] shrink-0 place-items-center rounded-[0.4em] border-[0.18cqh]',
    active ? 'border-navy bg-blue text-white' : 'border-line bg-white text-navy',
    disabled ? 'cursor-not-allowed opacity-40' : '',
  ].join(' ')
}

/** 分组之间的竖向细分隔线。 */
const dividerClass = 'h-[3cqh] w-px shrink-0 bg-line'

function onColorInput(event: Event): void {
  color.value = (event.target as HTMLInputElement).value
}
</script>

<template>
  <div
    class="flex items-center gap-[0.55em] rounded-[0.5em] border-[0.25cqh] border-navy bg-paper/95 px-[0.7em] py-[0.45cqh]"
    :aria-label="labels.toolsAria"
  >
    <!-- 工具组 -->
    <button
      v-for="item in TOOLS"
      :key="item.key"
      type="button"
      :class="itemClass(tool === item.key, !props.canDraw)"
      :disabled="!props.canDraw"
      :aria-label="item.aria"
      :title="item.label"
      @click="tool = item.key"
    >
      <component :is="item.icon" />
    </button>

    <span :class="dividerClass" aria-hidden="true"></span>

    <!-- 色板：8 个预设 + 自定义取色 -->
    <button
      v-for="paint in presetColors"
      :key="paint"
      type="button"
      class="aspect-square h-[2.9cqh] shrink-0 rounded-full border-[0.16cqh] bg-(--paint)"
      :class="
        color.toUpperCase() === paint
          ? 'border-navy outline-[0.26cqh] outline-focus outline-offset-[0.1cqh]'
          : 'border-control'
      "
      :style="{ '--paint': paint }"
      :aria-label="strings.game.presetColorAria(paint)"
      :title="strings.game.presetColorAria(paint)"
      :disabled="!props.canDraw"
      @click="color = paint"
    ></button>
    <label
      class="relative grid aspect-square h-[2.9cqh] shrink-0 cursor-pointer place-items-center rounded-full border-[0.16cqh] bg-white"
      :class="
        isCustomColor
          ? 'border-navy outline-[0.26cqh] outline-focus outline-offset-[0.1cqh]'
          : 'border-control'
      "
      :title="strings.game.customColorTitle"
    >
      <Pipette class="pointer-events-none h-[62%] w-[62%] text-navy" aria-hidden="true" />
      <input
        type="color"
        class="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0"
        :value="color"
        :disabled="!props.canDraw"
        :aria-label="strings.game.customColorAria"
        @input="onColorInput"
      />
    </label>

    <span :class="dividerClass" aria-hidden="true"></span>

    <!-- 画笔大小：只显示数值，悬停变画笔圆点，滚轮调整 -->
    <BrushSizeField v-model="width" :disabled="!props.canDraw" :color="color" />

    <span :class="dividerClass" aria-hidden="true"></span>

    <!-- 历史操作组 -->
    <button
      v-for="item in HISTORY"
      :key="item.key"
      type="button"
      :class="itemClass(false, !props.canDraw)"
      :disabled="!props.canDraw"
      :aria-label="item.aria"
      :title="item.label"
      @click="store.drawAction(item.event)"
    >
      <component :is="item.icon" />
    </button>
  </div>
</template>
