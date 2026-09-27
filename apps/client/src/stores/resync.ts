/**
 * 重连 / 重同步 Store：客户端权威自愈的单一入口。
 *
 * 为什么存在：重连后的权威重同步此前散在 room store（冷却、在途、世代与房间有效性、
 * 重解析、重采纳）、useRoomSync（门禁决策）、useAppBootstrap（非法推送恢复与会话失效清理）
 * 之间，room store 本应只持有数据。本模块集中两件事（见 docs/adr/0025-resync-module.md）：
 *
 * 1. `requestFullSnapshot` —— 受限全量重同步：冷却窗口、在途去重、发起时的会话/房间上下文、
 *    迟到响应有效性校验、协议重解析与快照门禁再采纳；
 * 2. `invalidateSession` —— 会话失效（房间关闭 / 连接被接管 / 注销）时的跨域重置：
 *    自增会话世代使在途响应失效，并清空房间与词库本地态。
 */
import { defineStore } from 'pinia'
import { APP_CONFIG } from '@draw-guess/config'
import { EVENTS } from '@draw-guess/shared'
import { useGameTransport } from '@/application/game-transport'
import { useRoomStore } from './room.ts'
import { useSessionStore } from './session.ts'
import { useVocabularyStore } from './vocabulary.ts'
import { acceptRoomSnapshot } from './snapshot-gate.ts'

/** 全量重同步的触发原因：非法推送 / 状态缺口 / 绘图回滚。 */
export type ResyncReason = 'invalid_push' | 'state_gap' | 'drawing_rollback'

export const useResyncStore = defineStore('resync', () => {
  const { request } = useGameTransport()
  const sessionStore = useSessionStore()
  const roomStore = useRoomStore()
  const vocabularyStore = useVocabularyStore()

  // 非响应式的自愈节流状态：冷却时间窗与在途标记。
  let resyncInFlight = false
  let lastResyncAt = 0

  /** 请求一次受冷却保护的权威全量快照；迟到响应必须仍属于发起时的会话与房间。 */
  async function requestFullSnapshot(reason: ResyncReason = 'state_gap'): Promise<void> {
    const current = roomStore.room
    if (!current || resyncInFlight) return
    const now = Date.now()
    if (now - lastResyncAt < APP_CONFIG.network.stateResyncCooldownMs) return
    resyncInFlight = true
    lastResyncAt = now
    const context = {
      generation: sessionStore.generation,
      roomId: current.id,
      gameId: current.game?.gameId,
      roundId: current.game?.roundId,
    }
    try {
      const result = await request(
        EVENTS.stateResync,
        {
          roomId: context.roomId,
          ...(context.gameId ? { gameId: context.gameId } : {}),
          ...(context.roundId ? { roundId: context.roundId } : {}),
          reason,
        },
        // 静默但仍重试：重同步是自愈路径，弹 Toast 只会与恢复遮罩重复（ADR-0022）。
        { notify: 'silent' },
      )
      if (!result.ok) return
      if (sessionStore.generation !== context.generation || roomStore.room?.id !== context.roomId)
        return
      if (result.data === undefined) {
        roomStore.room = undefined
        return
      }
      // ack 已在 request 解码缝按 CLIENT_RESPONSE_SCHEMAS（同一 RoomSnapshotSchema）校验并
      // 类型收窄——此处不再做第二次 safeParse（解码单点）。前提：快照 Schema 链为纯校验、
      // 无 transform/default；若未来给快照链引入 transform，必须重审解码侧（ADR-0025）。
      // 下面是状态比较而非解码：房间标识核对 + 快照门禁，属重同步自愈的裁决。
      if (result.data.id !== context.roomId) return
      if (acceptRoomSnapshot(roomStore.room, result.data) !== 'accept') return
      roomStore.room = result.data
    } finally {
      resyncInFlight = false
    }
  }

  /**
   * 会话失效时的跨域重置：自增会话世代（使在途请求与词库响应失效）并清空房间与词库本地态。
   * 跨域编排集中在此动作，调用方（bootstrap）不再自行串联多个 store。
   */
  function invalidateSession(): void {
    sessionStore.incrementGeneration()
    roomStore.clearLocalRoomState()
    vocabularyStore.clear()
  }

  return { requestFullSnapshot, invalidateSession }
})
