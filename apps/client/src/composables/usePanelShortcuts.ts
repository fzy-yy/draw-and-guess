/**
 * 对局面板快捷键（画板工具快捷键见 useShortcuts）。
 *
 * 聊天面板已常驻右栏，移除快捷键 C 显隐控制；
 * 保留固定回车键快捷聚焦猜词框逻辑：
 * - 用户在对局中按下 Enter 键，自动聚焦猜词输入框，提升键盘打字丝滑度；
 * - 输入控件与可聚焦的原生控件（链接/按钮）拥有按键优先权：前者避免打断输入，
 *   后者避免抢走回车对这些控件的原生「激活」语义。
 */
import { nextTick, onBeforeUnmount, onMounted } from 'vue'
import type { useGameStore } from '@/stores/game'

type GameStore = ReturnType<typeof useGameStore>

/** 文本输入控件：快捷键必须让位，否则会打断猜词与设置编辑。 */
function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null
  return (
    element?.isContentEditable === true ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName ?? '')
  )
}

/** 原生可聚焦控件：回车对它们有「激活」语义，不得被面板快捷键抢走。 */
function isNativeActivationTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null
  return element?.closest?.('button, a[href], [role="button"]') != null
}

export function usePanelShortcuts(options: {
  /** 对局状态仓库（保留类型扩展性）。 */
  store?: GameStore
  /** 聚焦猜词框（由 ChatPanel 暴露）。 */
  focusChatInput: () => void
  /** 是否接管按键（例如对局内设置弹窗打开时应让位）。 */
  enabled?: () => boolean
}): void {
  function keyHandler(event: KeyboardEvent): void {
    if (options.enabled && !options.enabled()) return
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return
    if (isEditableTarget(event.target)) return

    // 固定回车：聚焦猜词输入框。
    if (event.key === 'Enter') {
      if (isNativeActivationTarget(event.target)) return
      event.preventDefault()
      void nextTick(() => options.focusChatInput())
      return
    }
  }

  onMounted(() => window.addEventListener('keydown', keyHandler))
  onBeforeUnmount(() => window.removeEventListener('keydown', keyHandler))
}
