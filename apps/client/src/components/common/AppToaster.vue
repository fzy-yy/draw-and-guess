<!--
  自替换 vue-sonner 的 Toast 堆栈渲染组件（配合 composables/useToasts.ts 使用）。

  设计目标（可扩展 / 灵活 / 全部约束在画框内）：
  - 只负责「渲染 + 动画」，队列状态、去重、超时、配色在 useToasts；
  - 以 .game-stage（position:relative + overflow-hidden）为定位与裁剪上下文：
    用 absolute 右上角堆叠，天然不会越出画框，无需任何第三方 fixed 覆盖 hack；
  - 外观：白色长条 + 小圆角 + 最左一条主题色小条 + 加粗文字，点击即消失；
  - 进出场沿用全局统一的 toast-* 过渡（淡入淡出），
    同一提示去重时用 Web Animations API 对当前元素重放一次「左弹跳」，
    连续多次触发也能逐次重放（不依赖 CSS 类切换的强制重排）。
-->
<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { useToasts } from '@/composables/useToasts'

const { toasts, dismiss, onBump } = useToasts()

// 每条 toast 的 DOM 引用（v-for :ref 按 id 收纳），供左弹跳动画精确定位到元素。
const toastEls = new Map<string, HTMLElement>()
function setToastRef(id: string, el: unknown): void {
  if (el instanceof HTMLElement) toastEls.set(id, el)
  else toastEls.delete(id)
}

/**
 * 左弹跳提示：对指定 toast 元素重放一次横向弹簧动画（向左一顿再回弹）。
 * 用 WAAPI 而非 CSS 类切换，保证同一条连续触发时每次都能重放。
 * 位移用 em（随 stage 字号缩放），保证不同缩放窗口下手感一致。
 */
function bounce(id: string): void {
  const el = toastEls.get(id)
  if (!el) return
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-1.4em)' },
      { transform: 'translateX(0.9em)' },
      { transform: 'translateX(-0.5em)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  )
}

// 订阅「去重弹跳」事件；组件卸载时注销，避免重复监听（HMR / 重建）。
const unbindBump = onBump(bounce)
onBeforeUnmount(unbindBump)
</script>

<template>
  <!--
    TransitionGroup name="toast"：复用全局 toast-* 过渡钩子（淡入淡出 + 轻微位移），
    move 用 .toast-move 平滑挤占相邻 toast 的位置。容器在画框内绝对定位右上角。
  -->
  <TransitionGroup
    name="toast"
    tag="div"
    class="app-toaster"
    aria-live="polite"
    aria-atomic="false"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :ref="(el) => setToastRef(toast.id, el)"
      class="toast-item"
      role="status"
      :aria-label="toast.text"
      @click="dismiss(toast.id)"
    >
      <span class="toast-bar" aria-hidden="true" />
      <span class="toast-text">{{ toast.text }}</span>
    </div>
  </TransitionGroup>
</template>
