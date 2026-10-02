/**
 * 通用右键菜单状态层（配合 components/common/ContextMenu.vue 使用）。
 *
 * 职责边界：
 * - 这里只维护「菜单是否打开 / 在哪弹 / 有哪些菜单项」这份状态与打开、关闭、激活三项行为；
 * - 定位夹取、键盘导航、点击外部关闭等渲染与交互细节全部交给 ContextMenu.vue，本模块不感知 DOM；
 * - 状态为模块级单例：任意场景调用同一份 open()，天然保证「同一时刻只有一个右键菜单」，
 *   无需在组件树里层层安放菜单实例，也不会被中间容器的 overflow 裁剪；
 * - 菜单项由调用方按场景构造（文案来源遵守 @draw-guess/strings），本层只负责在激活时执行其 action。
 *
 * 使用方式：任意视图 / 组合式函数内 `const menu = useContextMenu()`，在右键处理里
 * `menu.open(event, [...])`；根舞台（App.vue）挂载唯一实例并接线 state 与 activate。
 */
import { shallowReactive } from 'vue'
import type { Component } from 'vue'

/** 右键菜单中的单个动作项。 */
export interface ContextMenuItem {
  /** 稳定标识：同一菜单内唯一，作为 v-for key 与调用方的识别依据。 */
  id: string
  /** 展示文案（调用方从 @draw-guess/strings 传入）。 */
  label: string
  /** 前置图标（lucide-vue-next 组件）；缺省时不渲染图标位。 */
  icon?: Component
  /** 禁用态：仍然渲染，但不可激活（视觉降级由组件负责）。 */
  disabled?: boolean
  /** 危险动作（如踢出成员）：文案与图标改用红色语义色。 */
  danger?: boolean
  /** 在该项之前渲染一条分组分隔线。 */
  separatorBefore?: boolean
  /** 激活回调；只应由 useContextMenu().activate 触发。 */
  action?: () => void
}

/** 弹出菜单时的可选参数。 */
interface ContextMenuOptions {
  /** 菜单无障碍名称；缺省由 ContextMenu.vue 使用 strings.a11y.common.contextMenuAria。 */
  ariaLabel?: string
}

/** 当前菜单状态（模块级单例，直接绑定给 ContextMenu 的 props 与 v-model:open）。 */
interface ContextMenuState {
  open: boolean
  /** 弹出位置：直接取右键事件的视口坐标，由组件换算成舞台内坐标后再夹取。 */
  x: number
  y: number
  items: readonly ContextMenuItem[]
  ariaLabel?: string
}

/*
 * 用 shallowReactive 而非 reactive：菜单项里可能携带 Vue 组件对象（图标），
 * 深层响应式会把组件对象也代理一层，既无意义又会触发运行时告警。
 * 菜单项整体替换（而非原地修改）已足够驱动重渲染。
 */
const state = shallowReactive<ContextMenuState>({
  open: false,
  x: 0,
  y: 0,
  items: [],
  ariaLabel: undefined,
})

/**
 * 在指针处弹出菜单。
 * @param event 触发弹出的右键事件（浏览器原生菜单在此处被阻止）
 * @param items 本次场景的菜单项；空列表视为无菜单可弹，直接关闭
 * @param options 可选参数（目前只有无障碍名称）
 */
function openContextMenu(
  event: MouseEvent,
  items: readonly ContextMenuItem[],
  options: ContextMenuOptions = {},
): void {
  event.preventDefault()
  if (!items.length) {
    closeContextMenu()
    return
  }
  // 先写内容与位置再置 open：避免渲染出上一场景的残留列表或旧坐标。
  state.items = items
  state.x = event.clientX
  state.y = event.clientY
  state.ariaLabel = options.ariaLabel
  state.open = true
}

/** 关闭菜单；保留 items 供离场动画继续渲染。幂等。 */
function closeContextMenu(): void {
  state.open = false
}

/** 执行菜单项动作；禁用项与无 action 项静默忽略。 */
function activateContextMenuItem(item: ContextMenuItem): void {
  if (item.disabled) return
  item.action?.()
}

/** 统一入口：读状态 + 打开 / 关闭 / 激活。 */
export function useContextMenu() {
  return {
    state,
    open: openContextMenu,
    close: closeContextMenu,
    activate: activateContextMenuItem,
  }
}
