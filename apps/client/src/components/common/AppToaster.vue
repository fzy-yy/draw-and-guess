<!--
  自替换 vue-sonner 的 Toast 堆栈渲染组件（配合 composables/useToasts.ts 使用）。

  设计目标（可扩展 / 灵活 / 全部约束在画框内）：
  - 只负责「渲染 + 动画」：队列状态、去重、超时在 useToasts；Toast 视觉（含小条的
    橙色派生配色）全部行内写在本组件模板，useToasts 不持有任何配色；
  - 以 .game-stage（position:relative + overflow-hidden）为定位与裁剪上下文：
    用 absolute 右上角堆叠，天然不会越出画框，无需任何第三方 fixed 覆盖 hack；
  - 外观：白色长条 + 方角 + 最左一条主题色小条 + 加粗文字，通过具名关闭按钮消失；
  - 样式与过渡动画全部收敛于组件内部行内维护，避免全局 CSS 污染；
  - 同一提示去重时用 Web Animations API 对当前元素重放一次「左弹跳」，
    连续多次触发也能逐次重放（不依赖 CSS 类切换的强制重排）。
-->
<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { playInteractionSound } from '@/audio'
import { useToasts } from '@/composables/useToasts'

const { toasts, dismiss, onBump } = useToasts()

function dismissWithSound(id: string): void {
  playInteractionSound('close')
  dismiss(id)
}

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
    TransitionGroup：使用统一管理于 style/animations.css 的 .toast-* 过渡钩子，
    容器在画框内绝对定位至右上角顶栏下方（top 12.5cqh，留出呼吸间距，不遮挡顶栏按钮）。
  -->
  <TransitionGroup
    name="toast"
    tag="div"
    class="pointer-events-none absolute top-[12.5cqh] right-[2.5cqh] z-[95] flex flex-col items-end gap-[1cqh]"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :ref="(el) => setToastRef(toast.id, el)"
      class="pointer-events-auto flex max-w-[44cqw] items-stretch overflow-hidden rounded-none bg-white text-navy shadow-float select-none"
      @pointerdown.stop
    >
      <span
        class="w-[0.6cqh] shrink-0 self-stretch bg-[color-mix(in_srgb,var(--color-yellow)_62%,var(--color-red))]"
        aria-hidden="true"
      />
      <span
        :role="toast.type === 'error' ? 'alert' : 'status'"
        :aria-live="toast.type === 'error' ? 'assertive' : 'polite'"
        aria-atomic="true"
        class="min-w-0 py-[1cqh] pr-[1.6cqh] pl-[1.2cqh] text-fs-14 font-bold leading-[1.4] whitespace-nowrap"
        >{{ toast.text }}</span
      >
      <button
        type="button"
        class="grid w-[4.4cqh] shrink-0 place-items-center border-l-[0.18cqh] border-control bg-white text-muted hover:bg-line"
        :aria-label="strings.common.dismissToastAria(toast.text)"
        @click.stop="dismissWithSound(toast.id)"
      >
        <X class="h-[2.2cqh] w-[2.2cqh]" aria-hidden="true" />
      </button>
    </div>
  </TransitionGroup>
</template>
