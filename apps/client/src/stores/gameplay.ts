/**
  局内对局与画布操作 Store。
  管理选词、猜词、绘图笔画与填充增量、局内暂停与提前结算。
*/
import { defineStore } from 'pinia'
import {
  ERROR_CODES,
  EVENTS,
  type FillCommand,
  type RoomSnapshot,
  type Stroke,
  type StrokeAck,
  type CanvasPingBroadcast,
  type CanvasPingType,
} from '@draw-guess/shared'
import { ref } from 'vue'
import { strings } from '@draw-guess/strings'
import { useGameTransport } from '@/application/game-transport'
import type { RequestResult } from './request.ts'
import { useRoomStore } from './room.ts'
import { useSessionStore } from './session.ts'
import { getErrorRecoveryAction } from './error-recovery.ts'

export const useGameplayStore = defineStore('gameplay', () => {
  const { request, notify } = useGameTransport()
  const roomStore = useRoomStore()
  const sessionStore = useSessionStore()

  /** 最近收到的画布微表情广播（带递增唯一序号以确保连续同类表情响应式触发） */
  const latestCanvasPing = ref<(CanvasPingBroadcast & { id: number }) | null>(null)
  let pingSequence = 0

  /** 本地 1.5 秒冷却时间戳（毫秒） */
  let lastLocalPingAt = 0

  /** 接收服务端广播的画布微表情推送并分发到响应式状态 */
  function handleCanvasPing(ping: CanvasPingBroadcast): void {
    latestCanvasPing.value = {
      ...ping,
      id: ++pingSequence,
    }
  }

  /** 发送微表情请求到服务端（附带客户端 1.5 秒滑动窗口冷却保护） */
  async function sendCanvasPing(x: number, y: number, type: CanvasPingType): Promise<boolean> {
    const now = Date.now()
    if (now - lastLocalPingAt < 1_500) {
      return false
    }
    lastLocalPingAt = now

    const result = await request(
      EVENTS.gameCanvasPing,
      {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        type,
      },
      { retry: false, notify: 'silent' },
    )
    return result.ok
  }

  /**
   * 新权威内容到达即不可逆地丢弃撤销历史（与服务端 drawing-service 的 discardUndone 同规则）：
   * 线性历史模型下，被撤销的命令一旦有新命令压在其后就永远无法合法 redo——镜像若继续保留，
   * 会让「复活已被覆盖的像素」成为可能，并使本地历史与权威历史逐条错位（整块重放结果不一致）；
   * 丢弃同时释放历史上限名额，「撤销/清空后可继续画」的恢复路径据此成立，
   * 见 docs/adr/0010-drawing-history-cap.md。
   */
  function purgeUndone(game: NonNullable<RoomSnapshot['game']>): void {
    if (game.undoneStrokeIds.length) {
      const undoneSet = new Set(game.undoneStrokeIds)
      game.strokes = game.strokes.filter((command) => !undoneSet.has(command.id))
      game.undoneStrokeIds = []
    }
  }

  async function startGame(): Promise<void> {
    if (!roomStore.room) return
    await request(EVENTS.gameStart, { expectedVersion: roomStore.room.stateVersion })
  }

  async function chooseWord(wordId: string): Promise<void> {
    if (!roomStore.room?.game) return
    await request(EVENTS.gameChooseWord, { roundId: roomStore.room.game.roundId, wordId })
  }

  async function rerollWords(): Promise<void> {
    if (!roomStore.room?.game) return
    await request(EVENTS.gameRerollWords, { roundId: roomStore.room.game.roundId })
  }

  /**
   * 画家自定义题目：确认即进入作画。返回是否成功——失败（被规则拒绝、格式不合法、撞词）
   * 时弹窗保持打开，让画家改词重试，错误文案由统一 ack 通道展示。
   */
  async function chooseCustomWord(text: string): Promise<boolean> {
    if (!roomStore.room?.game) return false
    const result = await request(EVENTS.gameCustomWord, {
      roundId: roomStore.room.game.roundId,
      text,
    })
    return result.ok
  }

  async function submitGuess(text: string): Promise<boolean> {
    if (!roomStore.room?.game) return false
    const result = await request(EVENTS.guessSubmit, {
      roundId: roomStore.room.game.roundId,
      text,
    })
    return result.ok
  }

  async function sendPreset(preset: string): Promise<boolean> {
    if (!roomStore.room?.game) return false
    const result = await request(EVENTS.chatPreset, {
      roundId: roomStore.room.game.roundId,
      preset,
    })
    return result.ok
  }

  /**
   * 无对局上下文时的合成拒绝（画布请求共用一份形状）：
   * 客户端本地就能判定「会话已失效」，不发请求直接按业务失败回给调用方。
   */
  function staleDrawingFailure<T>(): RequestResult<T> {
    return {
      ok: false,
      failureKind: 'business',
      error: strings.ui.request.genericFailure,
      code: ERROR_CODES.STALE_DRAWING_CONTEXT,
      timeout: false,
    }
  }

  /** 画布容量告警统一口径：预算/命令数上限类拒绝提示一次，其余错误保持静默（ADR-0022）。 */
  function warnDrawingCapacity(result: RequestResult<unknown>): void {
    if (!result.ok && getErrorRecoveryAction(result.code) === 'warn-drawing-limit') {
      notify(result.error, 'warning')
    }
  }

  async function sendStroke(stroke: Stroke): Promise<RequestResult<StrokeAck>> {
    if (!roomStore.room?.game) return staleDrawingFailure<StrokeAck>()
    const result = await request(
      EVENTS.drawStrokeBatch,
      { roundId: roomStore.room.game.roundId, stroke },
      // 高频绘图：不弹 Toast、不盲目重发（收敛靠权威快照与增量推送；ADR-0022）。
      { retry: false, notify: 'silent' },
    )
    warnDrawingCapacity(result)
    return result
  }

  async function sendFill(fill: FillCommand): Promise<RequestResult<{ drawingRevision: number }>> {
    if (!roomStore.room?.game) return staleDrawingFailure<{ drawingRevision: number }>()
    const result = await request(
      EVENTS.drawFillCommit,
      { roundId: roomStore.room.game.roundId, fill },
      // 与 sendStroke 同一口径：静默高频 + 容量类拒绝提示一次。
      { retry: false, notify: 'silent' },
    )
    warnDrawingCapacity(result)
    return result
  }

  async function drawAction(
    event: typeof EVENTS.drawUndo | typeof EVENTS.drawRedo | typeof EVENTS.drawClear,
  ): Promise<void> {
    if (!roomStore.room?.game) return
    await request(
      event,
      { roundId: roomStore.room.game.roundId },
      { retry: false, notify: 'silent' },
    )
  }

  async function pause(reason: string = strings.ui.store.pauseReasonHost): Promise<void> {
    await request(EVENTS.gamePauseRequest, { reason })
  }

  async function resume(): Promise<void> {
    await request(EVENTS.gameResume)
  }

  async function endEarly(): Promise<void> {
    await request(EVENTS.gameEndEarly)
  }

  async function leaveGame(): Promise<void> {
    const result = await request(EVENTS.gameLeave)
    if (!result.ok) return
    roomStore.clearLocalRoomState()
    sessionStore.page = 'lobby'
    notify(strings.ui.store.roomLeft)
  }

  async function returnWaiting(): Promise<void> {
    await request(EVENTS.gameReturnWaiting)
  }

  function handleStrokeBatch(roundId: string, stroke: Stroke): void {
    const game = roomStore.room?.game
    if (!game || game.roundId !== roundId) return
    const existing = game.strokes.find(
      (item): item is Stroke => item.kind === 'stroke' && item.id === stroke.id,
    )
    if (existing && !game.undoneStrokeIds.includes(existing.id)) {
      if (stroke.sequence <= existing.sequence) return
      existing.points.push(...stroke.points)
      existing.sequence = stroke.sequence
    } else if (existing) {
      // 该笔画 id 处于「已撤销」状态又收到迟到批次：恢复其既有历史点并追加本批点，
      // 并把它从 undoneStrokeIds 移除（取消撤销），避免 purgeUndone 把历史点一并丢弃。
      existing.points.push(...stroke.points)
      existing.sequence = Math.max(existing.sequence, stroke.sequence)
      game.undoneStrokeIds = game.undoneStrokeIds.filter((id) => id !== existing.id)
    } else {
      // 新命令追加前按与服务端同一规则丢弃撤销历史：镜像与权威历史逐条一致是增量/整帧
      // 重放正确的前提（为什么不保留可 redo 的尾巴见上方 purgeUndone 注释与 ADR-0010）。
      purgeUndone(game)
      // 画布历史只由服务端权威裁决：达到上限时服务端会拒绝新命令（DRAW_HISTORY_LIMIT_REACHED），
      // 客户端绝不自行裁剪——静默丢弃最旧命令会让早期封闭边界从重放历史里消失，
      // 使本地重放与权威历史不一致（见 docs/adr/0010-drawing-history-cap.md）。
      game.strokes.push({ ...stroke, points: [...stroke.points] })
    }
  }

  function handleFillCommit(roundId: string, fill: FillCommand): void {
    const game = roomStore.room?.game
    if (!game || game.roundId !== roundId || game.strokes.some((item) => item.id === fill.id))
      return
    purgeUndone(game)
    game.strokes.push(fill)
  }

  return {
    startGame,
    chooseWord,
    rerollWords,
    chooseCustomWord,
    submitGuess,
    sendPreset,
    sendStroke,
    sendFill,
    drawAction,
    pause,
    resume,
    endEarly,
    leaveGame,
    returnWaiting,
    handleStrokeBatch,
    handleFillCommit,
    latestCanvasPing,
    handleCanvasPing,
    sendCanvasPing,
  }
})
