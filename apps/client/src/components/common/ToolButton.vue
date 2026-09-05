<!--
  绘图工具栏工具按钮：收敛 DrawingToolbar 中 6 个长串行内类（画笔/橡皮擦/填充/撤销/重做/清空）。
  统一底座样式、激活态（bg-blue text-white）与可选快捷键 kbd；内容（图标/文字）经默认插槽传入。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'
import BaseIconButton from '@/components/common/BaseIconButton.vue'

const props = withDefaults(
  defineProps<{
    /** 是否为当前选中工具（激活态用蓝底白字）。 */
    active?: boolean
    /** 禁用态（如非画家或阶段不匹配）。 */
    disabled?: boolean
    /** 无障碍标签。 */
    ariaLabel?: string
    /** 若提供则在右侧渲染快捷键 kbd（调用方应仅在“显示快捷键提示”开启时传入）。 */
    shortcut?: string
  }>(),
  { active: false, disabled: false, ariaLabel: undefined, shortcut: undefined },
)
const emit = defineEmits<{ click: [] }>()

const baseClass = computed(() =>
  cn(
    'flex min-h-[4.6cqh] items-center gap-[0.35em] rounded-[0.55em] px-[0.7em] text-fs-12 font-bold',
    props.active ? 'text-white bg-blue' : 'bg-line text-navy',
  ),
)
</script>

<template>
  <BaseIconButton
    :label="ariaLabel"
    :disabled="disabled"
    :base-class="baseClass"
    @click="emit('click')"
  >
    <slot />
    <kbd
      v-if="shortcut"
      class="bg-white px-[0.35em] py-[0.1em] min-w-[1.6em] rounded-[0.35em] border-[0.12em] text-navy text-fs-12 uppercase font-mono"
      >{{ shortcut }}</kbd
    >
  </BaseIconButton>
</template>
