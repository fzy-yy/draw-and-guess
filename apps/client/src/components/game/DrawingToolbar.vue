<!--
  底部绘图工具栏（从 GameView.vue 拆出的子组件）：
  工具/颜色/线宽/历史操作。tool/color/width 由父组件持有并传入（props），
  本次修改通过 update:tool / update:color / width-change 事件回写；
  历史操作（撤销/重做）直接调用 store.drawAction，清空则向上抛 clear 事件交给父组件确认。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Brush, Eraser, PaintBucket, Pipette, RotateCcw, RotateCw, Trash2 } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { EVENTS, type ToolKind } from '@draw-guess/shared'
import { playInteractionSound } from '@/audio'
import { useGameStore } from '@/stores/game'
import ToolButton from '@/components/common/ToolButton.vue'

// 当前工具/颜色/线宽由 defineModel 双向绑定
const tool = defineModel<ToolKind>('tool', { required: true })
const color = defineModel<string>('color', { required: true })
const width = defineModel<number>('width', { required: true })
const emit = defineEmits<{ clear: [] }>()

const store = useGameStore()

/** 切换工具（画笔/橡皮擦/填充）。 */
function setTool(nextTool: ToolKind): void {
  tool.value = nextTool
}
/** 选择预设色块。 */
function setColor(nextColor: string): void {
  color.value = nextColor
  playInteractionSound('select')
}
/** 任意颜色取色器输入（原生 input[type=color] 事件）。 */
function onColorInput(event: Event): void {
  color.value = (event.target as HTMLInputElement).value
}
/** 当前颜色不在预设色板内 → 滴管按钮显示选中描边（提示自定义色生效中）。 */
const isCustomColor = computed(
  () => !store.config.drawing.colors.some((paint) => color.value.toUpperCase() === paint),
)
/** 线宽滑块拖拽（原生 range 事件，转回数字）。 */
function onWidthInput(event: Event): void {
  width.value = Number((event.target as HTMLInputElement).value)
}
/** 清空画板：只抛事件，确认与执行由父组件负责。 */
function clearCanvas(): void {
  emit('clear')
}
</script>

<template>
  <!-- 底部绘图工具栏：工具 / 颜色 / 线宽 / 历史操作（非画家时整条禁用）。
       四组控件随舞台等比缩放（紧凑布局已移除，不再按窗口高度换行）。 -->
  <footer
    v-if="store.room"
    class="col-span-full grid grid-cols-[minmax(0,1.35fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_auto] items-center gap-[1.2em] border-t-[0.25cqh] border-navy bg-paper px-[1.4cqw]"
    :class="{ 'text-muted': !store.isDrawer || store.room.phase !== 'drawing' }"
  >
    <!-- 工具组：画笔 / 橡皮擦 / 填充，可自定义快捷键 -->
    <div class="flex items-center gap-[0.45em]">
      <span class="mr-[0.3em] text-muted text-fs-10 font-bold">{{ strings.game.toolGroup }}</span>
      <ToolButton
        :active="tool === 'pen'"
        :disabled="!store.isDrawer"
        :aria-label="strings.game.penAria(store.settings.penShortcut)"
        :shortcut="store.settings.showShortcuts ? store.settings.penShortcut : undefined"
        audio-feedback="select"
        @click="setTool('pen')"
      >
        <Brush />{{ strings.game.penTool }}
      </ToolButton>
      <ToolButton
        :active="tool === 'eraser'"
        :disabled="!store.isDrawer"
        :aria-label="strings.game.eraserAria(store.settings.eraserShortcut)"
        :shortcut="store.settings.showShortcuts ? store.settings.eraserShortcut : undefined"
        audio-feedback="select"
        @click="setTool('eraser')"
      >
        <Eraser />{{ strings.game.eraserTool }}
      </ToolButton>
      <ToolButton
        :active="tool === 'fill'"
        :disabled="!store.isDrawer"
        :aria-label="strings.game.fillAria(store.settings.fillShortcut)"
        :shortcut="store.settings.showShortcuts ? store.settings.fillShortcut : undefined"
        audio-feedback="select"
        @click="setTool('fill')"
      >
        <PaintBucket />{{ strings.game.fillTool }}
      </ToolButton>
    </div>
    <!-- 颜色组：预设色块 + 任意颜色选择器 -->
    <div class="flex items-center justify-center gap-[0.45em]">
      <span class="mr-[0.3em] text-muted text-fs-10 font-bold">{{ strings.game.colorGroup }}</span>
      <!-- 色板属密集控件（8+1 个并排）：视觉尺寸设 16px 下限（responsive.minDenseTargetPx），
           避免小舞台下缩到看不清；其余情况随舞台等比缩放。 -->
      <button
        v-for="paint in store.config.drawing.colors"
        :key="paint"
        type="button"
        class="h-[max(3.5cqh,16px)] w-[max(3.5cqh,16px)] shrink-0 rounded-full border-[0.2cqh] bg-(--paint)"
        :class="
          color.toUpperCase() === paint
            ? 'outline-[0.3cqh] outline-focus outline-offset-[0.15cqh] border-navy'
            : 'border-control'
        "
        :style="{ '--paint': paint }"
        :aria-label="strings.game.presetColorAria(paint)"
        :disabled="!store.isDrawer"
        @click="setColor(paint)"
      ></button>
      <!-- 自定义取色：滴管图标按钮（与预设色块同尺寸同下限），点击唤起系统取色器。
           原生 color input 以 opacity-0 铺在图标上（label 点击直接命中控件，无需 showPicker 兼容）；
           当前颜色不在预设色板内时按钮显示选中描边。 -->
      <label
        class="relative grid h-[max(3.5cqh,16px)] w-[max(3.5cqh,16px)] shrink-0 cursor-pointer place-items-center rounded-full border-[0.2cqh]"
        :class="[
          isCustomColor
            ? 'outline-[0.3cqh] outline-focus outline-offset-[0.15cqh] border-navy'
            : 'border-control',
          store.isDrawer ? '' : 'cursor-not-allowed opacity-50',
        ]"
        :title="strings.game.customColorTitle"
      >
        <Pipette class="pointer-events-none h-[62%] w-[62%] text-navy" aria-hidden="true" />
        <input
          type="color"
          class="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0"
          :value="color"
          :disabled="!store.isDrawer"
          :aria-label="strings.game.customColorAria"
          @input="onColorInput"
          @change="playInteractionSound('select')"
        />
      </label>
    </div>
    <!-- 线宽滑块：画笔与橡皮擦共用；填充工具下禁用；数值固定两位宽度避免 9→10 抙动 -->
    <label class="flex items-center gap-[0.45em]">
      <span class="mr-[0.3em] flex items-center text-muted text-fs-10 font-bold tabular-nums"
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
        @change="playInteractionSound('select')"
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
        :audio-feedback="null"
        @click="clearCanvas"
      >
        <Trash2 /> {{ strings.game.clear }}
      </ToolButton>
    </div>
  </footer>
</template>
