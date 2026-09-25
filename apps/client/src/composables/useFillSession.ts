import { ref } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import { APP_CONFIG } from '@draw-guess/config'
import { EVENTS, type ClientResponse } from '@draw-guess/shared'
import type { RequestResult } from '@/stores/request'

/** 填充 ack 携带服务端画布修订，用于判断本地是否已追平并安全解除提交锁。 */
type FillAck = ClientResponse<typeof EVENTS.drawFillCommit>

/**
 * 洪泛填充的**提交态锁**（本地填充已发出、等权威修订追平）。
 *
 * ADR-0009 定义的两把锁中，渲染态（有填充任务在重放计算）已随 ADR-0018 收进
 * DrawingReplayMachine（`onRenderingChange` 回调）；本 composable 只保留提交锁——
 * 它裁决的是「与服务器之间是否还有一笔未确认的填充」，属交互会话概念，
 * 与画布如何重放无关。组件层把两者合成 canFill 门禁：
 * 画布仍在整帧重放、或上一笔填充尚未被权威确认时，不接受新的填充点击。
 *
 * 解锁路径只有三条：权威修订追平 ack 修订、ack 业务/传输失败、超时兜底；
 * 任何重放、推送或回合内的其它画布事件都不得提前解锁。
 */
export function useFillSession(options: {
  /** 权威画布修订（对应 ack 的 drawingRevision）。 */
  revision: () => number
  /** 当前回合：回合切换会作废旧回合的提交锁与迟到 ack。 */
  roundId: () => string
}) {
  const submitPending = ref(false)
  let pendingRevision: number | undefined

  const { start: startReleaseTimer, stop: stopReleaseTimer } = useTimeoutFn(
    releaseSubmit,
    APP_CONFIG.network.requestTimeoutMs,
    { immediate: false },
  )

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

  /** 回合切换或卸载：作废提交锁与超时兜底。 */
  function reset(): void {
    releaseSubmit()
  }

  return {
    submitPending,
    beginSubmit,
    settleSubmit,
    syncRevision,
    reset,
  }
}
