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
} from '@draw-guess/shared'
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

  async function sendStroke(stroke: Stroke): Promise<RequestResult<StrokeAck>> {
    if (!roomStore.room?.game)
      return {
        ok: false,
        failureKind: 'business',
        error: strings.request.genericFailure,
        code: ERROR_CODES.STALE_DRAWING_CONTEXT,
        timeout: false,
      }
    const result = await request(
      EVENTS.drawStrokeBatch,
      { roundId: roomStore.room.game.roundId, stroke },
      { quiet: true },
    )
    if (!result.ok) {
      if (getErrorRecoveryAction(result.code) === 'warn-drawing-limit') {
        notify(result.error ?? strings.request.genericFailure, 'warning')
      }
      return result
    }
    return result
  }

  async function sendFill(fill: FillCommand): Promise<RequestResult<{ drawingRevision: number }>> {
    if (!roomStore.room?.game)
      return {
        ok: false,
        failureKind: 'business',
        error: strings.request.genericFailure,
        code: ERROR_CODES.STALE_DRAWING_CONTEXT,
        timeout: false,
      }
    const result = await request(
      EVENTS.drawFillCommit,
      { roundId: roomStore.room.game.roundId, fill },
      { quiet: true },
    )
    // 与 sendStroke 同一口径：画布容量类拒绝（预算或命令数上限）提示一次，其余错误保持静默。
    if (!result.ok && getErrorRecoveryAction(result.code) === 'warn-drawing-limit') {
      notify(result.error ?? strings.request.genericFailure, 'warning')
    }
    return result
  }

  async function drawAction(
    event: typeof EVENTS.drawUndo | typeof EVENTS.drawRedo | typeof EVENTS.drawClear,
  ): Promise<void> {
    if (!roomStore.room?.game) return
    await request(event, { roundId: roomStore.room.game.roundId }, { quiet: true })
  }

  async function pause(reason: string = strings.store.pauseReasonHost): Promise<void> {
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
    notify(strings.store.roomLeft)
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
      // 并把它从 undoneStrokeIds 移除（取消撤销），避免 purgeUndone 把历史点一并丢弃（#7）。
      existing.points.push(...stroke.points)
      existing.sequence = Math.max(existing.sequence, stroke.sequence)
      game.undoneStrokeIds = game.undoneStrokeIds.filter((id) => id !== existing.id)
    } else {
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
    purgeUndone,
  }
})
