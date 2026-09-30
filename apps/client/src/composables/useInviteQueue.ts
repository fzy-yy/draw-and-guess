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
    // 与 decline() 对称：发起接受请求的同时立即停表。
    // 若不停，请求在途期间倒计时归零会再自动补发一次 reject——用户已明确接受
    // 的邀请仍被客户端自动应答拒绝，属多余的矛盾请求（最终结果以服务端裁决为准，
    // 但这个竞态窗口必须消除）。
    stop()
    const current = store.invites[0]
    if (current) void store.respondInvite(current.id, true)
  }

  return { rejectCountdown, decline, accept }
}
