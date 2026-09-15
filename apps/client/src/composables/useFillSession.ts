import { computed, ref } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import { APP_CONFIG } from '@draw-guess/config'
import { EVENTS, type ClientResponse } from '@draw-guess/shared'
import type { RequestResult } from '@/stores/request'

/** 填充 ack 携带服务端画布修订，用于判断本地是否已追平并安全解除提交锁。 */
type FillAck = ClientResponse<typeof EVENTS.drawFillCommit>

export interface FillSessionOptions {
  /** 权威画布修订（对应 ack 的 drawingRevision）。 */
  revision: () => number
  /** 当前回合：回合切换会作废旧回合的提交锁与迟到 ack。 */
  roundId: () => string
}

/**
 * 洪泛填充的两把锁（会话级状态机，见 docs/adr/0009-fill-degradation-and-locks.md）：
 *
 * - **渲染态** `renderBusy`：有填充任务在算（重放历史里的 fill）。由任务 `finally` 无条件释放，
 *   与世代、回合都无关；重叠重放（新一轮重放在旧任务 finally 之前启动）用计数保证不误放。
 * - **提交态** `submitPending`：本地填充已发出、等权威修订追平。只由对应 `drawingRevision`
 *   追平或超时兜底释放——任何重放、推送或回合内的其它画布事件都不得提前解锁。
 *
 * 两者合并为 `canSubmit` 门禁：画布仍在中途重放、或上一笔填充尚未被权威确认时，不接受新的填充点击。
 */
export function useFillSession(options: FillSessionOptions) {
  const renderBusy = ref(false)
  const submitPending = ref(false)
  const canSubmit = computed(() => !renderBusy.value && !submitPending.value)
  let renderTasks = 0
  let pendingRevision: number | undefined

  const { start: startReleaseTimer, stop: stopReleaseTimer } = useTimeoutFn(
    releaseSubmit,
    APP_CONFIG.network.requestTimeoutMs,
    { immediate: false },
  )

  function beginRenderTask(): void {
    renderTasks += 1
    renderBusy.value = true
  }

  /** 任务的成功、失败与取消出口都必须调用一次，避免渲染态把填充门禁永久锁死。 */
  function endRenderTask(): void {
    renderTasks = Math.max(0, renderTasks - 1)
    renderBusy.value = renderTasks > 0
  }

  function releaseSubmit(): void {
    submitPending.value = false
    pendingRevision = undefined
    stopReleaseTimer()
  }

  /** 本地填充发出前调用：进入待确认态，并作废上一笔确认的兜底定时器。 */
  function beginSubmit(): void {
    submitPending.value = true
    pendingRevision = undefined
    stopReleaseTimer()
  }

  /**
   * ack 结算：`roundId` 是提交发起时的回合，与之不符的迟到 ack 一律丢弃。
   * 业务/传输失败立即解锁；成功则等本地修订追平，推送被重同步兜底延迟时由超时兜底解锁。
   */
  function settleSubmit(result: RequestResult<FillAck>, roundId: string): void {
    // 已解锁（超时兜底）或提交发生在其它回合：迟到 ack 不得重新上锁。
    if (!submitPending.value || roundId !== options.roundId()) return
    if (!result.ok) {
      releaseSubmit()
      return
    }
    pendingRevision = result.data.drawingRevision
    if (options.revision() >= pendingRevision) {
      releaseSubmit()
      return
    }
    startReleaseTimer()
  }

  /** 权威修订或回合变化后调用：修订追平 ack 修订即解锁。 */
  function syncRevision(): void {
    if (pendingRevision === undefined) return
    if (options.revision() >= pendingRevision) releaseSubmit()
  }

  /** 回合切换或卸载：作废提交锁与超时兜底（渲染态由任务自身 finally 释放）。 */
  function reset(): void {
    releaseSubmit()
  }

  return {
    renderBusy,
    submitPending,
    canSubmit,
    beginRenderTask,
    endRenderTask,
    beginSubmit,
    settleSubmit,
    syncRevision,
    reset,
  }
}
