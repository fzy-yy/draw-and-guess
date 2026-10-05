<!--
  底部横向绘图工具条：手柄拖动 / 工具 / 色板 / 画笔大小 / 历史操作，单行，浮于画布底部居中。
  最左侧提供六点拖动手柄，支持在画布可视区内自由拖拽移动（拖动与定位由共用外壳
  `DraggablePanelShell` 单点维护，接龙作答浮层复用同一实现，见 S86）；
  仅「画笔大小」显示数值，其余全 icon + title / aria；工具与色板复用共享原语，激活态由原语统一。
  可见性由父组件控制（仅对画家自动显示，猜词者隐藏且不可被隐藏）；
  定位在自身外层完成，内层做缩放，避免 WAAPI 的 transform 覆盖造成跳动。
  tool / color / width / position 由父组件持有；
  清空需二次确认，故抛 clear 事件交父组件处理（撤销 / 重做直接调 store）。
-->
<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  Brush,
  Eraser,
  GripVertical,
  PaintBucket,
  Palette,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { EVENTS, type ToolKind } from '@draw-guess/shared'
import { playInteractionSound } from '@/audio'
import { useGameStore } from '@/stores/game'
import { ColorSwatchButton, GroupDivider, SquareIconButton } from '@/components/common'
import { scaleFadeEnter, scaleFadeLeave } from '@/components/game/scale-fade.ts'
import BrushSizeField from '@/components/game/BrushSizeField.vue'
import DraggablePanelShell from '@/components/game/DraggablePanelShell.vue'
import { focusToolbar, toolbarZIndex } from '@/components/game/floating-panel-z'
import type { PanelPosition } from '@/components/game'

const props = defineProps<{
  canDraw: boolean
  /** 是否展示（顶栏「工具」开关；隐藏时执行退出动画）。 */
  visible: boolean
}>()
const emit = defineEmits<{ clear: [] }>()

const tool = defineModel<ToolKind>('tool', { required: true })
const color = defineModel<string>('color', { required: true })
const width = defineModel<number>('width', { required: true })
const position = defineModel<PanelPosition | null>('position', { default: null })

const store = useGameStore()

const TOOLS: ReadonlyArray<{ key: ToolKind; icon: Component; label: string; aria: string }> = [
  {
    key: 'pen',
    icon: Brush,
    label: strings.a11y.game.penTool,
    aria: strings.a11y.game.penAria(store.settings.penShortcut),
  },
  {
    key: 'eraser',
    icon: Eraser,
    label: strings.a11y.game.eraserTool,
    aria: strings.a11y.game.eraserAria(store.settings.eraserShortcut),
  },
  {
    key: 'fill',
    icon: PaintBucket,
    label: strings.a11y.game.fillTool,
    aria: strings.a11y.game.fillAria(store.settings.fillShortcut),
  },
]

type HistoryKey = 'undo' | 'redo' | 'clear'
const HISTORY: ReadonlyArray<{ key: HistoryKey; icon: Component; label: string; aria: string }> = [
  { key: 'undo', icon: Undo2, label: strings.a11y.game.undo, aria: strings.a11y.game.undoAria },
  { key: 'redo', icon: Redo2, label: strings.a11y.game.redo, aria: strings.a11y.game.redoAria },
  { key: 'clear', icon: Trash2, label: strings.a11y.game.clear, aria: strings.a11y.game.clearAria },
]

const presetColors = store.config.drawing.colors
/** 当前颜色不在预设色板内 → 滴管按钮显示选中环（提示自定义色生效中）。 */
const isCustomColor = computed(
  () => !presetColors.some((paint) => color.value.toUpperCase() === paint),
)

/** 选择预设颜色：更新颜色并在处于橡皮擦时自动切回画笔，播放交互音效。 */
function selectColor(nextColor: string): void {
  color.value = nextColor
  if (tool.value === 'eraser') {
    tool.value = 'pen'
  }
  playInteractionSound('select')
}

/** 自定义取色滑动预览：实时更新颜色与工具状态，保持静音避免拖拽发出高频杂音。 */
function selectCustomColorPreview(nextColor: string): void {
  color.value = nextColor
  if (tool.value === 'eraser') {
    tool.value = 'pen'
  }
}

/** 自定义取色提交确认：在松开光标或关闭调色板时播放一次确认音效。 */
function selectCustomColorCommit(nextColor: string): void {
  color.value = nextColor
  playInteractionSound('select')
}

/** 历史操作：撤销 / 重做直接调 store，清空只抛事件（确认与执行归父组件）。 */
function runHistory(key: HistoryKey): void {
  if (key === 'undo') void store.drawAction(EVENTS.drawUndo)
  else if (key === 'redo') void store.drawAction(EVENTS.drawRedo)
  else emit('clear')
}
</script>

<template>
  <DraggablePanelShell
    v-model:position="position"
    :default-class="'bottom-[1.2cqh] left-1/2 -translate-x-1/2'"
    :drag-title="strings.a11y.game.dragToolbarTitle"
    :drag-aria="strings.a11y.game.dragToolbarAria"
    :style="{ zIndex: String(toolbarZIndex) }"
    @activate="focusToolbar"
  >
    <template #default="{ drag }">
      <Transition :css="false" @enter="scaleFadeEnter" @leave="scaleFadeLeave">
        <div
          v-if="visible"
          role="toolbar"
          :aria-label="strings.a11y.game.toolbarAria"
          class="flex items-center gap-[0.55em] rounded-[0.5em] border-[0.25cqh] border-navy bg-paper/95 px-[0.7em] py-[0.45cqh]"
        >
          <!-- 拖动手柄：按住可拖动工具条在画布内移动（绑定与定位来自共用外壳） -->
          <div v-bind="drag" class="px-[0.1em] py-[0.2em] hover:text-navy">
            <GripVertical class="h-[2.4cqh] w-[2.4cqh]" />
          </div>

          <!-- 工具组：画笔 / 橡皮擦 / 填充 -->
          <SquareIconButton
            v-for="item in TOOLS"
            :key="item.key"
            :active="tool === item.key"
            :disabled="!props.canDraw"
            :label="item.aria"
            :title="item.label"
            audio-feedback="select"
            @click="tool = item.key"
          >
            <component :is="item.icon" />
          </SquareIconButton>

          <GroupDivider />

          <!-- 色板：预设色 + 自定义取色，选中环由 ColorSwatchButton 统一 -->
          <ColorSwatchButton
            v-for="paint in presetColors"
            :key="paint"
            :paint="paint"
            :selected="color.toUpperCase() === paint"
            :label="strings.a11y.game.presetColorAria(paint)"
            :disabled="!props.canDraw"
            @select="selectColor"
          />
          <ColorSwatchButton
            custom
            :paint="color"
            :selected="isCustomColor"
            :label="strings.a11y.game.customColorTitle"
            :aria-label="strings.a11y.game.customColorAria"
            :disabled="!props.canDraw"
            @select="selectCustomColorPreview"
            @commit="selectCustomColorCommit"
          >
            <Palette class="pointer-events-none h-[62%] w-[62%] text-navy" aria-hidden="true" />
          </ColorSwatchButton>

          <GroupDivider />

          <!-- 画笔大小：只显示数值，悬停变画笔圆点，滚轮调整 -->
          <BrushSizeField v-model="width" :disabled="!props.canDraw" :color="color" />

          <GroupDivider />

          <!-- 历史操作组：撤销 / 重做 / 清空 -->
          <SquareIconButton
            v-for="item in HISTORY"
            :key="item.key"
            :disabled="!props.canDraw"
            :label="item.aria"
            :title="item.label"
            :audio-feedback="item.key === 'clear' ? null : 'activate'"
            @click="runHistory(item.key)"
          >
            <component :is="item.icon" />
          </SquareIconButton>
        </div>
      </Transition>
    </template>
  </DraggablePanelShell>
</template>
