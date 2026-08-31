/**
 * 画板快捷键与工具切换组合式逻辑：自定义单键切工具 + 撤销/重做组合键。
 * 从 GameView 拆出；输入框等可编辑元素拥有键盘优先权，避免打断猜词或设置编辑。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { EVENTS, type ToolKind } from '@draw-guess/shared'
import type { useGameStore } from '@/stores/game'

type GameStore = ReturnType<typeof useGameStore>

/** 输入框、选择器及可编辑元素拥有键盘优先权，避免工具快捷键打断猜词或设置编辑。 */
function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null
  return (
    element?.isContentEditable === true ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName ?? '')
  )
}

/** 对比快捷键时统一忽略大小写和首尾空白。 */
function normalizedShortcut(value: string): string {
  return value.trim().toLocaleLowerCase()
}

/** 画家画板快捷键状态：当前工具选择与快捷键监听生命周期。 */
export function useShortcuts(store: GameStore) {
  const tool = ref<ToolKind>('pen')

  /** 画家可用自定义单键切换工具；撤销与重做继续使用通用组合键。 */
  function keyHandler(event: KeyboardEvent): void {
    if (!store.isDrawer || store.room?.phase !== 'drawing' || isEditableTarget(event.target)) return
    const key = event.key.toLocaleLowerCase()
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault()
      void store.drawAction(event.shiftKey ? EVENTS.drawRedo : EVENTS.drawUndo)
      return
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault()
      void store.drawAction(EVENTS.drawRedo)
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return
    const shortcuts: Array<[ToolKind, string]> = [
      ['pen', store.settings.penShortcut],
      ['eraser', store.settings.eraserShortcut],
      ['fill', store.settings.fillShortcut],
    ]
    const matched = shortcuts.find(([, shortcut]) => normalizedShortcut(shortcut) === key)
    if (matched) {
      event.preventDefault()
      tool.value = matched[0]
    }
  }

  onMounted(() => window.addEventListener('keydown', keyHandler))
  onBeforeUnmount(() => window.removeEventListener('keydown', keyHandler))

  return { tool }
}
