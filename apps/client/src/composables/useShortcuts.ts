/**
 * 画板快捷键与工具切换组合式逻辑：自定义单键切工具 + 撤销/重做组合键。
 * 从 GameView 拆出；输入框等可编辑元素拥有键盘优先权，避免打断猜词或设置编辑。
 * 按键判定与设置页的捕获校验共用 utils/keyboard.ts 的同一规则。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { EVENTS, type ToolKind } from '@draw-guess/shared'
import { playInteractionSound } from '@/audio'
import { normalizedShortcut } from '@/utils/keyboard'
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

/** 经典画家与接龙当前棒作画者共用的画板快捷键状态。 */
export function useShortcuts(store: GameStore) {
  const tool = ref<ToolKind>('pen')

  /** 接龙仅在拥有本棒画布且尚未提交时响应快捷键，保持与画板写入权限一致。 */
  function canUseDrawingShortcuts(): boolean {
    const room = store.room
    if (!room) return false
    if (room.gameMode === 'relay') {
      return (
        room.relay?.phase === 'relay_draw' &&
        room.relay.ownCanvas !== undefined &&
        !room.relay.submitted
      )
    }
    return store.isDrawer && room.phase === 'drawing'
  }

  /** 画板快捷键仅在当前玩家实际有作画权限时处理。 */
  function keyHandler(event: KeyboardEvent): void {
    if (!canUseDrawingShortcuts() || isEditableTarget(event.target)) return
    const key = event.key.toLocaleLowerCase()
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault()
      playInteractionSound('activate')
      void store.drawAction(event.shiftKey ? EVENTS.drawRedo : EVENTS.drawUndo)
      return
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault()
      playInteractionSound('activate')
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
      playInteractionSound('select')
      tool.value = matched[0]
    }
  }

  onMounted(() => window.addEventListener('keydown', keyHandler))
  onBeforeUnmount(() => window.removeEventListener('keydown', keyHandler))

  return { tool }
}
