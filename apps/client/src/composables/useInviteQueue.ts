import { onUnmounted, ref, watch } from 'vue'
import { useGameStore } from '@/stores/game'

/** 队首邀请横幅倒计时与接受/拒绝动作。 */
export function useInviteQueue() {
  const store = useGameStore()
  const rejectCountdown = ref(store.config.ui.inviteRejectCountdownSeconds)
  let timer: number | undefined

  function stop(): void {
    window.clearInterval(timer)
    timer = undefined
  }

  function start(): void {
    stop()
    if (!store.invites[0] || store.room) return
    rejectCountdown.value = store.config.ui.inviteRejectCountdownSeconds
    timer = window.setInterval(() => {
      rejectCountdown.value -= 1
      if (rejectCountdown.value > 0) return
      stop()
      const pending = store.invites[0]
      if (pending) void store.respondInvite(pending.id, false)
    }, 1_000)
  }

  watch(() => store.invites[0]?.id, start, { immediate: true })
  watch(
    () => Boolean(store.invites.length && !store.room),
    (visible) => (visible ? start() : stop()),
  )
  onUnmounted(stop)

  function decline(): void {
    stop()
    const current = store.invites[0]
    if (current) void store.respondInvite(current.id, false)
  }

  function accept(): void {
    const current = store.invites[0]
    if (current) void store.respondInvite(current.id, true)
  }

  return { rejectCountdown, decline, accept }
}
