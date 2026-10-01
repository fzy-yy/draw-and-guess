<!--
  原型单图标按钮：面板/工具栏「收起成一个图标」后的形态。
  半透明纸底 + 深蓝描边 + 阴影，与画布形成明确的浮层层级；可选右上角计数徽章与激活态。
  位置（absolute 等）由调用方经 class 透传——根类名必须走 cn() 合并，
  否则基础类里的 relative 会与调用方的 absolute 冲突（Tailwind 同权重按样式表顺序决胜，
  relative 会赢），悬浮按钮就会被父容器裁剪（曾在画布底部 FAB 上实际发生）。
-->
<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import { cn } from '@/utils/cn'

// 根节点类名完全由 rootClass 决定（含调用方透传的定位类），禁止自动合并造成重复
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  /** 无障碍标签与悬浮提示（收起态按钮无可见文字，必须提供）。 */
  label: string
  /** 右上角计数徽章（如未读消息数）；不传则不渲染。 */
  badge?: number | string
  /** 激活态（对应面板已展开，用于单坞图标轨的选中高亮）。 */
  active?: boolean
}>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()

const attrs = useAttrs()
/** 徽章的定位以按钮自身为包含块：按钮是 relative 或 absolute 都成立。 */
const rootClass = computed(() =>
  cn(
    'relative grid h-[4.6cqh] w-[4.6cqh] place-items-center rounded-[0.55em] border-[0.25cqh] shadow-block',
    props.active
      ? 'border-navy bg-blue text-white'
      : 'border-navy bg-paper/95 text-navy hover:bg-sky',
    attrs.class,
  ),
)
</script>

<template>
  <button
    type="button"
    :class="rootClass"
    :aria-label="label"
    :title="label"
    @click="emit('click', $event)"
  >
    <slot />
    <span
      v-if="badge !== undefined && badge !== ''"
      class="absolute -top-[0.5cqh] -right-[0.5cqh] grid h-[2.4cqh] min-w-[2.4cqh] place-items-center rounded-full bg-red px-[0.2em] text-fs-10 font-bold text-white"
      >{{ badge }}</span
    >
  </button>
</template>
