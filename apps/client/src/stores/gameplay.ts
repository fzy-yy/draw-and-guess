/**
  局内对局与画布操作 Store。
  管理选词、猜词、绘图笔画与填充增量、局内暂停与提前结算。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { APP_CONFIG } from '@draw-guess/config'
import {
  EVENTS,
  type FillCommand,
  type RoomSnapshot,
  type Stroke,
  type StrokeAck,
} from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { notify } from '@/composables/useToasts'
import { socket } from './socket.ts'
import { createRequester } from './request.ts'
import { useRoomStore } from './room.ts'
import { useSessionStore } from './session.ts'

export const useGameplayStore = defineStore('gameplay', () => {
  const roomStore = useRoomStore()
  const sessionStore = useSessionStore()
  const drawRevision = ref(0)
  const request = createRequester({ socket, notify })

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
    const result = await request<undefined>(EVENTS.guessSubmit, {
      roundId: roomStore.room.game.roundId,
      text,
    })
    return result.ok
  }

  async function sendPreset(preset: string): Promise<void> {
    if (!roomStore.room?.game) return
    await request(EVENTS.chatPreset, { roundId: roomStore.room.game.roundId, preset })
  }

  async function sendStroke(stroke: Stroke): Promise<StrokeAck | undefined> {
    if (!roomStore.room?.game) return undefined
    const result = await request<StrokeAck>(
      EVENTS.drawStrokeBatch,
      { roundId: roomStore.room.game.roundId, stroke },
      { quiet: true },
    )
    if (!result.ok) {
      if (result.code === 'DRAW_BUDGET_EXCEEDED') {
        notify(result.error ?? strings.request.genericFailure, 'warning')
      }
      return undefined
    }
    return result.data
  }

  async function sendFill(fill: FillCommand): Promise<void> {
    if (!roomStore.room?.game) return
    await request(
      EVENTS.drawFillCommit,
      { roundId: roomStore.room.game.roundId, fill },
      { quiet: true },
    )
  }

  async function drawAction(event: string): Promise<void> {
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
    const result = await request<undefined>(EVENTS.gameLeave)
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
    } else {
      purgeUndone(game)
      game.strokes.push({ ...stroke, points: [...stroke.points] })
      if (game.strokes.length > APP_CONFIG.drawing.maxHistoryCommands) game.strokes.shift()
    }
    drawRevision.value += 1
  }

  function handleFillCommit(roundId: string, fill: FillCommand): void {
    const game = roomStore.room?.game
    if (!game || game.roundId !== roundId || game.strokes.some((item) => item.id === fill.id))
      return
    purgeUndone(game)
    game.strokes.push(fill)
    if (game.strokes.length > APP_CONFIG.drawing.maxHistoryCommands) game.strokes.shift()
    drawRevision.value += 1
  }

  return {
    drawRevision,
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
