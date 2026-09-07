import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useGameStore } from '@/stores/game'

/** 首次进入大厅的全屏提示及浏览器 fullscreenchange 生命周期。 */
export function useFullscreenPrompt() {
  const store = useGameStore()
  const showFullscreenPrompt = ref(false)
  const storageKey = store.config.app.fullscreenPromptSessionKey

  function markHandled(): void {
    window.sessionStorage.setItem(storageKey, '1')
    showFullscreenPrompt.value = false
  }

  function check(): void {
    if (!store.playerId || store.page !== 'lobby' || store.room || store.invites.length) {
      showFullscreenPrompt.value = false
      return
    }
    if (document.fullscreenElement) {
      markHandled()
      return
    }
    showFullscreenPrompt.value = !window.sessionStorage.getItem(storageKey)
  }

  watch(() => [store.playerId, store.page, store.room, store.invites.length], check, {
    immediate: true,
  })

  function handleFullscreenChange(): void {
    if (document.fullscreenElement) markHandled()
  }
  onMounted(() => document.addEventListener('fullscreenchange', handleFullscreenChange))
  onUnmounted(() => document.removeEventListener('fullscreenchange', handleFullscreenChange))

  async function confirm(): Promise<void> {
    markHandled()
    const stage = document.querySelector<HTMLElement>('.game-stage')
    if (!stage || document.fullscreenElement) return
    try {
      await stage.requestFullscreen()
    } catch {
      // 浏览器权限策略静默降级。
    }
  }

  return { showFullscreenPrompt, confirm, dismiss: markHandled }
}
