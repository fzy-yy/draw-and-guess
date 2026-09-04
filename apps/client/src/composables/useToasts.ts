/**
 * 轻量 Toast 状态层（自替换 vue-sonner 的纯手写实现）。
 *
 * 职责边界：
 * - 这里只维护「待展示 toast 队列」这份状态与基础行为：新增 / 按统一 key 去重合并 / 自动超时消失 / 手动关闭；
 * - 样式与动画完全交给 AppToaster.vue 渲染，本模块不感知任何 DOM 或 CSS；
 * - 队列为模块级单例（reactive），无论多少个组件调用 useToasts，读到的都是同一份队列。
 *
 * 去重语义：以 `type:text` 作为稳定 key，同一条提示在未消失时再次触发，
 * 不复用堆叠，而是「重置消失计时 + 触发一次左弹跳提示」（bumpTick 单调递增，
 * 由 AppToaster 监听并播放弹跳动画），保持提示不刷屏。
 *
 * 配色：Toast 视觉统一走 AppToaster.vue 的 .toast-bar（橙色由 index.css 统一给出），
 * 本状态层不再持有每颗 toast 的配色，因此无需随机取色。
 */
import { reactive } from 'vue'
import { nanoid } from 'nanoid'
import { APP_CONFIG } from '@draw-guess/config'

export type ToastType = 'success' | 'warning' | 'error'

export interface ToastItem {
  /** 稳定 toast 唯一 ID（nanoid，用作 v-for key / 元素 ref 定位） */
  id: string
  /** 去重 key：`${type}:${text}`，同 key 只保留一条 */
  key: string
  type: ToastType
  /** 展示文案 */
  text: string
  /**
   * 弹跳播放计数：同一条再次触发时自增，供 AppToaster 每次检测到自增即重放左弹跳动画。
   * 只增不减，因此无需重置也能对「重复触发」逐次响应。
   */
  bumpTick: number
}

/** 模块级单例队列：最新一条在前（顶部）。 */
const toasts = reactive<ToastItem[]>([])
/** 每条 toast 的自动消失计时器（存 window id，便于重置/清理）。 */
const timers = new Map<string, number>()
/** 供 AppToaster 注册弹跳动画触发器（解耦：状态层只管计分，播放交给渲染层）。 */
const bumpListeners = new Set<(id: string) => void>()

/** 取消并移除一条 toast；幂等（不论是否已消失都能安全调用）。 */
export function dismiss(id: string): void {
  const timer = timers.get(id)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timers.delete(id)
  }
  const index = toasts.findIndex((toast) => toast.id === id)
  if (index !== -1) toasts.splice(index, 1)
}

/** 重置（或首次建立）一条 toast 的自动消失计时器。 */
function scheduleDismiss(id: string, duration: number): void {
  const prev = timers.get(id)
  if (prev !== undefined) window.clearTimeout(prev)
  timers.set(
    id,
    window.setTimeout(() => dismiss(id), duration),
  )
}

/**
 * 推送一条通知。
 * @param text 展示文案（调用方传入，文案来源统一遵守 config/strings.ts）
 * @param type 通知类型（沿用旧 API）
 */
export function notify(text: string, type: ToastType = 'success'): void {
  const key = `${type}:${text}`
  const existing = toasts.find((toast) => toast.key === key)
  // 同一条已有且未消失：重置计时 + 触发左弹跳，不再新建堆叠。
  if (existing) {
    existing.bumpTick += 1
    for (const listener of bumpListeners) listener(existing.id)
    scheduleDismiss(existing.id, APP_CONFIG.ui.toastDurationMs)
    return
  }
  const item: ToastItem = { id: nanoid(), key, type, text, bumpTick: 0 }
  toasts.unshift(item)
  scheduleDismiss(item.id, APP_CONFIG.ui.toastDurationMs)
}

/** 注册「某条 toast 被去重并需弹跳」的监听器；返回注销函数。 */
export function onBump(listener: (id: string) => void): () => void {
  bumpListeners.add(listener)
  return () => bumpListeners.delete(listener)
}

/** 统一入口：读队列 + 推送 + 关闭 + 订阅弹跳事件。 */
export function useToasts() {
  return { toasts, notify, dismiss, onBump }
}
