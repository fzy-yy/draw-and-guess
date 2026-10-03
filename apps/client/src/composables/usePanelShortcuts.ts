/**
 * 对局面板显隐快捷键（画板工具快捷键见 useShortcuts）。
 *
 * 聊天面板拥有可在设置页修改的单键快捷键；
 * 聊天面板额外固定一个回车键，语义刻意不对称：
 * - 回车**只能打开**聊天面板或聚焦其输入框，**永不隐藏**——因为回车同时是猜词框的发送键，
 *   若允许它关闭面板，就会与「打字回车发送」争夺同一个按键；
 * - 可配置的那一个按键才是真正意义上的开关（开 ↔ 关）。
 *
 * 底部绘图工具条对画家自动显示、猜词者隐藏且不可被隐藏，因此无显隐快捷键；
 *
 * 玩家面板是常驻左栏（占位、不浮动、不可关闭），因此没有快捷键。
 * 输入控件与可聚焦的原生控件（链接/按钮）拥有按键优先权：前者避免打断输入，
 * 后者避免抢走回车对这些控件的原生「激活」语义。
 */
import { nextTick, onBeforeUnmount, onMounted, type Ref } from 'vue'
import { normalizedShortcut } from '@/utils/keyboard'
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
  store: GameStore
  /** 聊天面板的开合状态（与顶栏开关共用同一份 ref）。 */
  chatOpen: Ref<boolean>
  /** 打开聊天后聚焦猜词框（由 ChatPanel 暴露）。 */
  focusChatInput: () => void
  /** 是否接管按键（例如对局内设置弹窗打开时应让位）。 */
  enabled?: () => boolean
}): void {
  function keyHandler(event: KeyboardEvent): void {
    if (options.enabled && !options.enabled()) return
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return
    if (isEditableTarget(event.target)) return

    // 固定回车：只打开聊天或聚焦输入框，永不隐藏。
    if (event.key === 'Enter') {
      if (isNativeActivationTarget(event.target)) return
      event.preventDefault()
      if (!options.chatOpen.value) options.chatOpen.value = true
      void nextTick(() => options.focusChatInput())
      return
    }

    const settings = options.store.settings
    const key = event.key.toLocaleLowerCase()
    if (key === normalizedShortcut(settings.chatPanelShortcut)) {
      event.preventDefault()
      options.chatOpen.value = !options.chatOpen.value
      return
    }
  }

  onMounted(() => window.addEventListener('keydown', keyHandler))
  onBeforeUnmount(() => window.removeEventListener('keydown', keyHandler))
}
