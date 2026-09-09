<!--
  通用操作提示横幅：
  浮动在舞台底部中央，采用统一的白底、蓝边与厚左边条（border-l-[1cqh]），
  配合 Transition name="banner" 平滑滑入滑出。
  支持自定义前置图示（头像/图标）、眉题与主文案、以及右侧操作按钮区。
  广泛复用于玩家房间邀请、全屏体验推荐等底部操作提示场景。
-->
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { cn } from '@/utils/cn'

const props = defineProps<{
  /** 横幅是否可见 */
  open: boolean
  /** 非模态动态区域的无障碍标签。 */
  ariaLabel?: string
  /** 顶部彩色眉题文本 */
  heading?: string
  /** 主提示文本 */
  message?: string
  /** 自定义外层样式覆盖 */
  class?: string
}>()

const root = ref<HTMLElement>()
let previousFocus: HTMLElement | undefined

watch(
  () => props.open,
  (open) => {
    if (open) {
      previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      return
    }
    const active = document.activeElement
    const focusTarget = previousFocus
    const focusWasRemoved = active === document.body || active === document.documentElement
    if (focusWasRemoved || root.value?.contains(active)) void nextTick(() => focusTarget?.focus())
    previousFocus = undefined
  },
  { flush: 'pre' },
)
</script>

<template>
  <Transition name="banner">
    <div
      v-if="open"
      ref="root"
      :class="
        cn(
          'absolute bottom-[3cqh] left-1/2 z-50 grid min-h-[10cqh] w-[66cqw] grid-cols-[auto_1fr_auto_auto] items-center gap-[1em] border-[0.3cqh] border-blue border-l-[1cqh] bg-white px-[1em] py-[1cqh] shadow-float -translate-x-1/2',
          props.class,
        )
      "
      role="region"
      :aria-label="ariaLabel"
      aria-live="polite"
      aria-atomic="true"
    >
      <!-- 左侧图示插槽（SVG 头像或图标徽章） -->
      <slot name="leading" />

      <!-- 中间文案区 -->
      <div class="flex min-w-0 flex-col">
        <slot name="heading">
          <span v-if="heading" class="text-blue text-fs-12 font-bold">{{ heading }}</span>
        </slot>
        <slot>
          <b v-if="message" class="truncate text-fs-14 text-navy" :title="message">{{ message }}</b>
        </slot>
      </div>

      <!-- 右侧操作按钮插槽 -->
      <slot name="actions" />
    </div>
  </Transition>
</template>
