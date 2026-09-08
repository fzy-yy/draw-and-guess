import { type FillCommand, type RoomSnapshot, type Stroke } from '@draw-guess/shared'
import { useGameplayStore } from '@/stores/gameplay'
import { useRoomStore } from '@/stores/room'
import {
  acceptDrawingIncrement,
  acceptRoomSnapshot,
  type DrawingIncrementMeta,
} from '@/stores/snapshot-gate'

/** 房间快照、绘图增量与受限全量重同步的单一协调器。 */
export function useRoomSync() {
  const roomStore = useRoomStore()
  const gameplayStore = useGameplayStore()
  const requestFullSnapshot = roomStore.requestFullSnapshot

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
