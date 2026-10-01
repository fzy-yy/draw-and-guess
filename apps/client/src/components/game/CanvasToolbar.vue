<!--
  底部横向绘图工具条：工具 / 色板 / 画笔大小 / 历史操作，单行、无阴影，浮于画布底部居中。
  仅「画笔大小」显示数值，其余全 icon + title / aria；工具与色板复用共享原语，激活态由原语统一。
  可见性由父组件经 visible 控制（顶栏「工具」开关），显隐走统一「淡入淡出 + 缩放」；
  定位在自身外层完成，内层做缩放，避免 WAAPI 的 transform 覆盖 -translate-x-1/2 造成水平跳动。
  tool / color / width 由父组件持有（v-model:tool / v-model:color / v-model:width）；
  清空需二次确认，故抛 clear 事件交父组件处理（撤销 / 重做直接调 store）。
-->
<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Brush, Eraser, PaintBucket, Pipette, RotateCcw, RotateCw, Trash2 } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { EVENTS, type ToolKind } from '@draw-guess/shared'
import { playInteractionSound } from '@/audio'
import { useGameStore } from '@/stores/game'
import { ColorSwatchButton, GroupDivider, SquareIconButton } from '@/components/common'
import { scaleFadeEnter, scaleFadeLeave } from '@/components/game/scale-fade.ts'
import BrushSizeField from '@/components/game/BrushSizeField.vue'

const props = defineProps<{
  /** 是否可绘制（非画家或非作画阶段时整条置灰）。 */
  canDraw: boolean
  /** 是否展示（顶栏「工具」开关；隐藏时执行退出动画）。 */
  visible: boolean
}>()
const emit = defineEmits<{ clear: [] }>()

const tool = defineModel<ToolKind>('tool', { required: true })
const color = defineModel<string>('color', { required: true })
const width = defineModel<number>('width', { required: true })

const store = useGameStore()

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

type HistoryKey = 'undo' | 'redo' | 'clear'
const HISTORY: ReadonlyArray<{ key: HistoryKey; icon: Component; label: string; aria: string }> = [
  { key: 'undo', icon: RotateCcw, label: strings.game.undo, aria: strings.game.undoAria },
  { key: 'redo', icon: RotateCw, label: strings.game.redo, aria: strings.game.redoAria },
  { key: 'clear', icon: Trash2, label: strings.game.clear, aria: strings.game.clearAria },
]

const presetColors = store.config.drawing.colors
/** 当前颜色不在预设色板内 → 滴管按钮显示选中环（提示自定义色生效中）。 */
const isCustomColor = computed(
  () => !presetColors.some((paint) => color.value.toUpperCase() === paint),
)

/** 选择颜色（预设或取色器）后播放统一交互音效。 */
function selectColor(nextColor: string): void {
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
  <div class="absolute bottom-[1.2cqh] left-1/2 z-[25] -translate-x-1/2">
    <Transition :css="false" @enter="scaleFadeEnter" @leave="scaleFadeLeave">
      <div
        v-if="visible"
        role="toolbar"
        :aria-label="strings.game.toolbarAria"
        class="flex items-center gap-[0.55em] rounded-[0.5em] border-[0.25cqh] border-navy bg-paper/95 px-[0.7em] py-[0.45cqh]"
      >
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
          :label="strings.game.presetColorAria(paint)"
          :disabled="!props.canDraw"
          @select="selectColor"
        />
        <ColorSwatchButton
          custom
          :paint="color"
          :selected="isCustomColor"
          :label="strings.game.customColorTitle"
          :disabled="!props.canDraw"
          @select="selectColor"
        >
          <Pipette class="pointer-events-none h-[62%] w-[62%] text-navy" aria-hidden="true" />
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
  </div>
</template>
