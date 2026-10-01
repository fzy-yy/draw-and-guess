<!--
  顶栏面板控制器（纯原型 UI）：玩家 / 聊天 / 工具三个单图标各自切换对应窗口开关，
  不改变画布布局；面板关闭时仍可从原按钮重新打开。画家视角额外显示固定宽度的
  画笔像素值，滚轮悬停在数值上即可微调，数值位数变化不会推挤图标按钮。
-->
<script setup lang="ts">
import { MessageSquare, Palette, Users } from 'lucide-vue-next'
import { labels } from './labels.ts'
import BrushSizeControl from './BrushSizeControl.vue'
import PanelIconButton from './PanelIconButton.vue'

const playersOpen = defineModel<boolean>('playersOpen', { required: true })
const chatOpen = defineModel<boolean>('chatOpen', { required: true })
const toolsOpen = defineModel<boolean>('toolsOpen', { required: true })
const brushWidth = defineModel<number>('brushWidth', { required: true })
defineProps<{ showTools: boolean }>()
</script>

<template>
  <nav
    class="absolute top-[10.7%] left-[1.1cqw] z-[80] flex items-center gap-[0.45em] rounded-[0.65em] border-[0.22cqh] border-white/20 bg-navy/95 p-[0.35em] shadow-block"
    :aria-label="labels.panelControlsAria"
  >
    <PanelIconButton
      :active="playersOpen"
      :label="playersOpen ? labels.collapsePlayers : labels.expandPlayers"
      @click="playersOpen = !playersOpen"
    >
      <Users />
    </PanelIconButton>
    <PanelIconButton
      :active="chatOpen"
      :badge="2"
      :label="chatOpen ? labels.collapseChat : labels.expandChat"
      @click="chatOpen = !chatOpen"
    >
      <MessageSquare />
    </PanelIconButton>
    <PanelIconButton
      v-if="showTools"
      :active="toolsOpen"
      :label="toolsOpen ? labels.collapseToolbar : labels.expandToolbar"
      @click="toolsOpen = !toolsOpen"
    >
      <Palette />
    </PanelIconButton>
    <span
      v-if="showTools"
      class="mx-[0.15em] h-[3.2cqh] w-px bg-white/30"
      aria-hidden="true"
    ></span>
    <BrushSizeControl v-if="showTools" v-model="brushWidth" compact />
  </nav>
</template>
