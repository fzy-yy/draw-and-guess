import { APP_CONFIG } from '@draw-guess/config'
import {
  EVENTS,
  RoomSnapshotSchema,
  type FillCommand,
  type RoomSnapshot,
  type Stroke,
} from '@draw-guess/shared'
import { notify } from '@/composables/useToasts'
import { createRequester } from '@/stores/request'
import { useGameplayStore } from '@/stores/gameplay'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { socket } from '@/stores/socket'
import {
  acceptDrawingIncrement,
  acceptRoomSnapshot,
  type DrawingIncrementMeta,
} from '@/stores/snapshot-gate'

/** 房间快照、绘图增量与受限全量重同步的单一协调器。 */
export function useRoomSync() {
  const roomStore = useRoomStore()
  const sessionStore = useSessionStore()
  const gameplayStore = useGameplayStore()
  const request = createRequester({ socket, notify })
  let resyncInFlight = false
  let lastResyncAt = 0

  async function requestFullSnapshot(): Promise<void> {
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
        },
        { quiet: true, retry: true },
      )
      if (!result.ok || result.data === undefined) return
      const parsed = RoomSnapshotSchema.safeParse(result.data)
      if (
        !parsed.success ||
        sessionStore.generation !== context.generation ||
        roomStore.room?.id !== context.roomId ||
        parsed.data.id !== context.roomId ||
        acceptRoomSnapshot(roomStore.room, parsed.data) !== 'accept'
      )
        return
      roomStore.room = parsed.data
    } finally {
      resyncInFlight = false
    }
  }

  function onRoomSnapshot(snapshot: RoomSnapshot): void {
    const current = roomStore.room
    const decision = acceptRoomSnapshot(current, snapshot)
    if (decision === 'ignore') return
    if (decision === 'resync') {
      void requestFullSnapshot()
      return
    }
    if (snapshot.game?.strokesOmitted) {
      const localGame = current?.game
      if (
        !localGame ||
        localGame.gameId !== snapshot.game.gameId ||
        localGame.roundId !== snapshot.game.roundId ||
        localGame.drawingRevision > snapshot.game.drawingRevision
      ) {
        void requestFullSnapshot()
        return
      }
      const localMaxSequence = localGame.strokes.reduce(
        (max, command) => Math.max(max, command.sequence),
        -1,
      )
      if (localMaxSequence < snapshot.game.lastSequence) {
        void requestFullSnapshot()
        return
      }
      snapshot = {
        ...snapshot,
        game: { ...snapshot.game, strokes: localGame.strokes, strokesOmitted: false },
      }
    }
    roomStore.room = snapshot
  }

  function acceptIncrement(meta: DrawingIncrementMeta): boolean {
    const decision = acceptDrawingIncrement(roomStore.room, meta)
    if (decision === 'resync') void requestFullSnapshot()
    return decision === 'accept'
  }

  function onStroke(meta: DrawingIncrementMeta, stroke: Stroke): void {
    if (!acceptIncrement(meta)) return
    gameplayStore.handleStrokeBatch(meta.roundId, stroke)
    if (roomStore.room?.game) roomStore.room.game.drawingRevision = meta.drawingRevision
  }

  function onFill(meta: DrawingIncrementMeta, fill: FillCommand): void {
    if (!acceptIncrement(meta)) return
    gameplayStore.handleFillCommit(meta.roundId, fill)
    if (roomStore.room?.game) roomStore.room.game.drawingRevision = meta.drawingRevision
  }

  return { requestFullSnapshot, onRoomSnapshot, onStroke, onFill }
}
