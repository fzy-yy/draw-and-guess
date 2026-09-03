<!--
  底部绘图工具栏（从 GameView.vue 拆出的子组件）：
  工具/颜色/线宽/历史操作。tool/color/width 由父组件持有并传入（props），
  本次修改通过 update:tool / update:color / width-change 事件回写；
  历史操作（撤销/重做）直接调用 store.drawAction，清空则向上抛 clear 事件交给父组件确认。
-->
<script setup lang="ts">
import { Brush, Eraser, PaintBucket, RotateCcw, RotateCw, Trash2 } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { EVENTS, type ToolKind } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import ToolButton from '@/components/common/ToolButton.vue'

// 当前工具/颜色/线宽由父组件管理，这里只读值、再把变更事件抛回去（受控组件）。
defineProps<{
  tool: ToolKind
  color: string
  width: number
}>()
const emit = defineEmits<{
  'update:tool': [tool: ToolKind]
  'update:color': [color: string]
  'width-change': [width: number]
  clear: []
}>()

const store = useGameStore()

/** 切换工具（画笔/橡皮擦/填充）。 */
function setTool(tool: ToolKind): void {
  emit('update:tool', tool)
}
/** 选择预设色块。 */
function setColor(color: string): void {
  emit('update:color', color)
}
/** 任意颜色取色器输入（原生 input[type=color] 事件）。 */
function onColorInput(event: Event): void {
  emit('update:color', (event.target as HTMLInputElement).value)
}
/** 线宽滑块拖拽（原生 range 事件，转回数字）。 */
function onWidthInput(event: Event): void {
  emit('width-change', Number((event.target as HTMLInputElement).value))
}
/** 清空画板：只抛事件，确认与执行由父组件负责。 */
function clearCanvas(): void {
  emit('clear')
}
</script>

<template>
  <!-- 底部绘图工具栏：工具 / 颜色 / 线宽 / 历史操作（非画家时整条禁用） -->
  <footer
    v-if="store.room"
    class="col-span-full grid grid-cols-[1.35fr_1fr_0.8fr_auto] items-center gap-[1.2em] border-t-[0.25cqh] border-navy bg-paper px-[1.4cqw]"
    :class="{ 'text-muted': !store.isDrawer || store.room.phase !== 'drawing' }"
  >
    <!-- 工具组：画笔 / 橡皮擦 / 填充，可自定义快捷键 -->
    <div class="flex items-center gap-[0.45em]">
      <span class="mr-[0.3em] text-muted text-[0.62em] font-extrabold">{{
        strings.game.toolGroup
      }}</span>
      <ToolButton
        :active="tool === 'pen'"
        :disabled="!store.isDrawer"
        :aria-label="strings.game.penAria(store.settings.penShortcut)"
        :shortcut="store.settings.showShortcuts ? store.settings.penShortcut : undefined"
        @click="setTool('pen')"
      >
        <Brush />{{ strings.game.penTool }}
      </ToolButton>
      <ToolButton
        :active="tool === 'eraser'"
        :disabled="!store.isDrawer"
        :aria-label="strings.game.eraserAria(store.settings.eraserShortcut)"
        :shortcut="store.settings.showShortcuts ? store.settings.eraserShortcut : undefined"
        @click="setTool('eraser')"
      >
        <Eraser />{{ strings.game.eraserTool }}
      </ToolButton>
      <ToolButton
        :active="tool === 'fill'"
        :disabled="!store.isDrawer"
        :aria-label="strings.game.fillAria(store.settings.fillShortcut)"
        :shortcut="store.settings.showShortcuts ? store.settings.fillShortcut : undefined"
        @click="setTool('fill')"
      >
        <PaintBucket />{{ strings.game.fillTool }}
      </ToolButton>
    </div>
    <!-- 颜色组：预设色块 + 任意颜色选择器 -->
    <div class="flex items-center justify-center gap-[0.45em]">
      <span class="mr-[0.3em] text-muted text-[0.62em] font-extrabold">{{
        strings.game.colorGroup
      }}</span>
      <button
        v-for="paint in store.config.drawing.colors"
        :key="paint"
        type="button"
        class="h-[3.5cqh] w-[3.5cqh] rounded-full border-[0.2cqh] border-line bg-(--paint)"
        :class="{
          'outline-[0.3cqh] outline-yellow outline-offset-[0.15cqh] border-navy!':
            color.toUpperCase() === paint,
        }"
        :style="{ '--paint': paint }"
        :aria-label="strings.game.presetColorAria(paint)"
        :disabled="!store.isDrawer"
        @click="setColor(paint)"
      ></button>
      <label
        class="relative h-[3.8cqh] w-[3.8cqh] overflow-hidden rounded-full border-[0.2cqh] border-line"
        :title="strings.game.customColorTitle"
      >
        <input
          type="color"
          class="absolute inset-[-1cqh] h-[6cqh] w-[6cqh] border-0 p-0"
          :value="color"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.customColorAria"
          @input="onColorInput"
        />
      </label>
    </div>
    <!-- 线宽滑块：画笔与橡皮擦共用；填充工具下禁用；数值固定两位宽度避免 9→10 抙动 -->
    <label class="flex items-center gap-[0.45em]">
      <span
        class="mr-[0.3em] flex items-center text-muted text-[0.62em] font-extrabold tabular-nums"
        >{{ strings.game.widthName
        }}<span class="inline-block min-w-[2ch] text-center">{{ width }}</span></span
      >
      <input
        type="range"
        class="w-[10cqw] accent-blue"
        :min="store.config.drawing.width.min"
        :max="store.config.drawing.width.max"
        :step="store.config.drawing.width.step"
        :value="width"
        :disabled="!store.isDrawer || tool === 'fill'"
        :aria-label="strings.game.widthAria"
        @input="onWidthInput"
      />
      <!-- 线宽预览圆点已移除：画笔光标已在画板上实时展示实际粗细，此处重复展示无必要 -->
    </label>
    <!-- 历史操作组：撤销 / 重做 / 清空 -->
    <div class="flex items-center gap-[0.45em]">
      <ToolButton
        :disabled="!store.isDrawer"
        :aria-label="strings.game.undoAria"
        @click="store.drawAction(EVENTS.drawUndo)"
      >
        <RotateCcw /> {{ strings.game.undo }}
      </ToolButton>
      <ToolButton
        :disabled="!store.isDrawer"
        :aria-label="strings.game.redoAria"
        @click="store.drawAction(EVENTS.drawRedo)"
      >
        <RotateCw /> {{ strings.game.redo }}
      </ToolButton>
      <ToolButton
        :disabled="!store.isDrawer"
        :aria-label="strings.game.clearAria"
        @click="clearCanvas"
      >
        <Trash2 /> {{ strings.game.clear }}
      </ToolButton>
    </div>
  </footer>
</template>
