/**
 * 接龙对局子 Store：接龙专属请求（绘图 5 条 / 提交 2 条 / 投票 / 独立聊天）与本地画布镜像维护。
 *
 * 为什么单独成 Store 而不塞进 gameplay：接龙的目标解析、提交语义与镜像维护都与经典不同
 * （S30 / S53 / S49），而经典路径必须逐条不变——经典动作继续留在 gameplay store，
 * 接龙动作经 façade 以 `relay*` 前缀暴露，两侧互不污染（S84 的「不并排复制」在状态层同理）。
 *
 * 画布镜像（本文件唯一容易踩坑的地方）：接龙绘图**零广播**（S49，服务端注入静默发布策略），
 * 服务端不回推任何命令，因此本客户端的权威镜像只能由提交 ack 自补——镜像落后于画布机器的
 * 已提交簿记时，机器会判定「权威历史比本地短」而整帧重建，把刚画出的笔画抹掉。
 * 自补规则与服务端 `domain/drawing/drawing-core.ts` 完全同口径（续接批次并回同一条命令、
 * 撤销栈、清空、修订单调），只做镜像记账、不做任何业务裁决（裁决权仍只在服务端）。
 *
 * 取舍与全景见 docs/adr/0058-relay-mode-authoritative-flow-and-reuse.md。
 */
import { computed } from 'vue'
import { defineStore } from 'pinia'
import {
  ERROR_CODES,
  EVENTS,
  normalizeHexColor,
  type FillCommand,
  type RelayCanvas,
  type RelayGameView,
  type RelayVoteChoice,
  type Stroke,
  type StrokeAck,
} from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameTransport } from '@/application/game-transport'
import type { RequestResult } from './request.ts'
import { useRoomStore } from './room.ts'
import { getErrorRecoveryAction } from './error-recovery.ts'

export const useRelayStore = defineStore('relay', () => {
  const { request, notify } = useGameTransport()
  const roomStore = useRoomStore()

  /** 当前接龙视图：随房间快照下发（终局仍由它承载排名与统计，S33）。 */
  const view = computed<RelayGameView | undefined>(() => roomStore.room?.relay)

  /**
   * 无接龙上下文时的合成拒绝（与经典 `staleDrawingFailure` 同形状）：
   * 本地就能判定「本棒已结束 / 会话失效」，不发请求直接按业务失败回给调用方，
   * 画布会话据此回滚乐观笔画。
   */
  const STALE_DRAWING_FAILURE: RequestResult<never> = {
    ok: false,
    failureKind: 'business',
    error: strings.ui.request.genericFailure,
    code: ERROR_CODES.STALE_DRAWING_CONTEXT,
    timeout: false,
  }

  /** 画布容量告警统一口径：预算类拒绝提示一次，其余错误保持静默（与经典同一套恢复动作）。 */
  function warnDrawingCapacity(result: RequestResult<unknown>): void {
    if (!result.ok && getErrorRecoveryAction(result.code) === 'warn-drawing-limit') {
      notify(result.error, 'warning')
    }
  }

  /**
   * 丢弃撤销栈：与服务端 `discardUndone` 同规则——线性历史下，被撤销的命令一旦有新命令压在其后
   * 就永远无法合法 redo，镜像继续保留会让「复活已被覆盖的像素」成为可能。
   */
  function discardUndone(canvas: RelayCanvas): void {
    if (!canvas.undoneStrokeIds.length) return
    const undone = new Set(canvas.undoneStrokeIds)
    canvas.strokes = canvas.strokes.filter((command) => !undone.has(command.id))
    canvas.undoneStrokeIds = []
  }

  /** 把服务端已接受的笔画并回本地镜像：续接批次并入同一条命令，整笔新命令从 0 起笔。 */
  function mirrorStroke(canvas: RelayCanvas, stroke: Stroke, revision: number): void {
    discardUndone(canvas)
    const color = normalizeHexColor(stroke.color)
    const existing = canvas.strokes.find(
      (command): command is Stroke => command.kind === 'stroke' && command.id === stroke.id,
    )
    if (existing) {
      existing.points = [...existing.points, ...stroke.points]
      existing.sequence = stroke.sequence
    } else {
      canvas.strokes = [...canvas.strokes, { ...stroke, color, points: [...stroke.points] }]
    }
    canvas.lastSequence = Math.max(canvas.lastSequence, stroke.sequence)
    canvas.drawingRevision = revision
  }

  /** 把服务端已接受的填充并回本地镜像（填充总是新增一条命令）。 */
  function mirrorFill(canvas: RelayCanvas, fill: FillCommand, revision: number): void {
    discardUndone(canvas)
    canvas.strokes = [...canvas.strokes, { ...fill, color: normalizeHexColor(fill.color) }]
    canvas.lastSequence = Math.max(canvas.lastSequence, fill.sequence)
    canvas.drawingRevision = revision
  }

  /** 撤销 / 重做 / 清空的本地镜像（与服务端 undoCommand / redoCommand / clearCanvas 同规则）。 */
  function mirrorHistory(canvas: RelayCanvas, action: 'undo' | 'redo' | 'clear'): void {
    if (action === 'clear') {
      // 空画布清空在服务端是「无变化」（不推进修订），镜像同样不动，避免修订号比权威多走一步。
      if (!canvas.strokes.length && !canvas.undoneStrokeIds.length) return
      canvas.strokes = []
      canvas.undoneStrokeIds = []
      canvas.lastSequence += 1
      canvas.drawingRevision += 1
      return
    }
    if (action === 'redo') {
      if (!canvas.undoneStrokeIds.length) return
      canvas.undoneStrokeIds = canvas.undoneStrokeIds.slice(0, -1)
      canvas.drawingRevision += 1
      return
    }
    const undone = new Set(canvas.undoneStrokeIds)
    const target = [...canvas.strokes].reverse().find((command) => !undone.has(command.id))
    if (!target) return
    canvas.undoneStrokeIds = [...canvas.undoneStrokeIds, target.id]
    canvas.drawingRevision += 1
  }

  /** 提交一批笔画：ack 成功后把命令并回镜像（零广播下镜像的唯一来源）。 */
  async function sendStroke(stroke: Stroke): Promise<RequestResult<StrokeAck>> {
    const relay = view.value
    const stepId = relay?.stepId
    // 作画棒的画布（可写）；猜词棒没有 ownCanvas（只有只读的上家画作），不该收到笔画。
    const canvas = relay?.ownCanvas
    if (!stepId || !canvas) return STALE_DRAWING_FAILURE
    const result = await request(
      EVENTS.relayDrawStrokeBatch,
      { stepId, stroke },
      // 高频绘图：不弹 Toast、不盲目重发（与经典同一口径，恢复正常靠快照与整帧重放）。
      { retry: false, notify: 'silent' },
    )
    warnDrawingCapacity(result)
    if (result.ok) mirrorStroke(canvas, stroke, result.data.drawingRevision)
    return result
  }

  /** 提交一次区域填充：ack 成功后把填充并回镜像。 */
  async function sendFill(fill: FillCommand): Promise<RequestResult<{ drawingRevision: number }>> {
    const relay = view.value
    const canvas = relay?.ownCanvas
    if (!relay?.stepId || !canvas) return STALE_DRAWING_FAILURE
    const result = await request(
      EVENTS.relayDrawFillCommit,
      { stepId: relay.stepId, fill },
      { retry: false, notify: 'silent' },
    )
    warnDrawingCapacity(result)
    if (result.ok) mirrorFill(canvas, fill, result.data.drawingRevision)
    return result
  }

  /** 撤销 / 重做 / 清空本棒的画布：事件名按接龙族选择，ack 成功后同步镜像。 */
  async function drawAction(
    event: typeof EVENTS.relayDrawUndo | typeof EVENTS.relayDrawRedo | typeof EVENTS.relayDrawClear,
  ): Promise<void> {
    const relay = view.value
    const canvas = relay?.ownCanvas
    if (!relay?.stepId || !canvas) return
    const result = await request(
      event,
      { stepId: relay.stepId },
      { retry: false, notify: 'silent' },
    )
    if (!result.ok) return
    if (event === EVENTS.relayDrawUndo) mirrorHistory(canvas, 'undo')
    else if (event === EVENTS.relayDrawRedo) mirrorHistory(canvas, 'redo')
    else mirrorHistory(canvas, 'clear')
  }

  /** 提交本棒猜词（`relay:submitGuess`）：只提交文本、提交即锁定，不进聊天流（S20）。 */
  async function submitGuess(text: string): Promise<boolean> {
    const stepId = view.value?.stepId
    if (!stepId) return false
    const result = await request(EVENTS.relaySubmitGuess, { stepId, text })
    return result.ok
  }

  /** 提交本棒作画（`relay:submitDrawing`）：只标记完成，交的是已有笔画（S30）。 */
  async function submitDrawing(): Promise<boolean> {
    const stepId = view.value?.stepId
    if (!stepId) return false
    const result = await request(EVENTS.relaySubmitDrawing, { stepId })
    return result.ok
  }

  /** 对当前复盘链投票（`relay:vote`）：目标由服务端游标决定，点下即锁定（S13 / S14）。 */
  async function vote(choice: RelayVoteChoice): Promise<boolean> {
    const result = await request(EVENTS.relayVote, { choice })
    return result.ok
  }

  /** 接龙独立聊天（`chat:say`）：自由社交频道，永不携带作答（S79 / S85）。 */
  async function chat(text: string): Promise<boolean> {
    const result = await request(EVENTS.chatSay, { text })
    return result.ok
  }

  return {
    view,
    sendStroke,
    sendFill,
    drawAction,
    submitGuess,
    submitDrawing,
    vote,
    chat,
  }
})
