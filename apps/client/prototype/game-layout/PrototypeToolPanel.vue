<!--
  原型绘图工具面板：纯图标工具与色板、撤销重做清空；线宽只显示像素数值和对应尺寸小圆点，
  不放滑条。鼠标滚轮悬停在数值控件或直接滚动画布，都驱动同一个 width，
  真实 GameCanvas 的光标圆点会按该线宽同步变化。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Brush, Eraser, PaintBucket, RotateCcw, RotateCw, Trash2 } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { EVENTS, type ToolKind } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import ToolButton from '@/components/common/ToolButton.vue'
import BrushSizeControl from './BrushSizeControl.vue'

const tool = defineModel<ToolKind>('tool', { required: true })
const color = defineModel<string>('color', { required: true })
const width = defineModel<number>('width', { required: true })
const props = withDefaults(defineProps<{ layout?: 'horizontal' | 'vertical' }>(), {
  layout: 'horizontal',
})

const store = useGameStore()
const vertical = computed(() => props.layout === 'vertical')
</script>

<template>
  <div
    class="grid min-h-0 h-full items-center gap-[0.75em] p-[0.7em]"
    :class="
      vertical
        ? 'grid-rows-[auto_auto_auto] content-start overflow-y-auto'
        : 'grid-cols-[auto_minmax(0,1fr)_auto] overflow-x-auto'
    "
  >
    <!-- 三个工具全部单图标，不用可见文字标签。 -->
    <div class="flex items-center gap-[0.35em]" :class="vertical && 'justify-center'">
      <ToolButton
        :active="tool === 'pen'"
        :disabled="!store.isDrawer"
        :aria-label="strings.game.penAria(store.settings.penShortcut)"
        audio-feedback="select"
        @click="tool = 'pen'"
      >
        <Brush />
      </ToolButton>
      <ToolButton
        :active="tool === 'eraser'"
        :disabled="!store.isDrawer"
        :aria-label="strings.game.eraserAria(store.settings.eraserShortcut)"
        audio-feedback="select"
        @click="tool = 'eraser'"
      >
        <Eraser />
      </ToolButton>
      <ToolButton
        :active="tool === 'fill'"
        :disabled="!store.isDrawer"
        :aria-label="strings.game.fillAria(store.settings.fillShortcut)"
        audio-feedback="select"
        @click="tool = 'fill'"
      >
        <PaintBucket />
      </ToolButton>
    </div>

    <!-- 颜色是密集的圆形色板，无文字；网格/横排由不同变体决定。 -->
    <div
      class="flex min-w-0 items-center gap-[0.35em]"
      :class="vertical ? 'flex-wrap justify-center' : 'justify-center'"
    >
      <button
        v-for="paint in store.config.drawing.colors"
        :key="paint"
        type="button"
        class="h-[max(3.2cqh,16px)] w-[max(3.2cqh,16px)] shrink-0 rounded-full border-[0.18cqh] bg-(--paint)"
        :class="
          color.toUpperCase() === paint
            ? 'outline-[0.28cqh] outline-focus outline-offset-[0.12cqh] border-navy'
            : 'border-control'
        "
        :style="{ '--paint': paint }"
        :aria-label="strings.game.presetColorAria(paint)"
        :disabled="!store.isDrawer"
        @click="color = paint"
      ></button>
    </div>

    <!-- 固定数字位宽避免 9px→10px 时相邻按钮位移；数字和示例圆点均可滚轮调节。 -->
    <div class="flex items-center gap-[0.55em]" :class="vertical && 'justify-center'">
      <BrushSizeControl v-model="width" />
      <ToolButton
        :disabled="!store.isDrawer"
        :aria-label="strings.game.undoAria"
        @click="store.drawAction(EVENTS.drawUndo)"
      >
        <RotateCcw />
      </ToolButton>
      <ToolButton
        :disabled="!store.isDrawer"
        :aria-label="strings.game.redoAria"
        @click="store.drawAction(EVENTS.drawRedo)"
      >
        <RotateCw />
      </ToolButton>
      <ToolButton
        :disabled="!store.isDrawer"
        :aria-label="strings.game.clearAria"
        :audio-feedback="null"
        @click="store.drawAction(EVENTS.drawClear)"
      >
        <Trash2 />
      </ToolButton>
    </div>
  </div>
</template>
