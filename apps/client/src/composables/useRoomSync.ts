import { type FillCommand, type RoomSnapshot, type Stroke } from '@draw-guess/shared'
import { useGameplayStore } from '@/stores/gameplay'
import { useRoomStore } from '@/stores/room'
import { useResyncStore } from '@/stores/resync'
import {
  acceptDrawingIncrement,
  acceptRoomSnapshot,
  type DrawingIncrementMeta,
} from '@/stores/snapshot-gate'

/**
 * 房间快照、绘图增量与受限全量重同步的单一协调器。
 *
 * `requestFullSnapshot` 只在协调器内部消费（绘图修订缺口、strokesOmitted 镜像落后两类
 * 补齐场景）；外部发起方（useAppBootstrap 的非法推送恢复、Facade / GameView 的回滚重同步）
 * 一律直连 resync store，不经本 composable 转发，因此返回值不暴露该成员。
 */
export function useRoomSync() {
  const roomStore = useRoomStore()
  const gameplayStore = useGameplayStore()
  const resyncStore = useResyncStore()
  const requestFullSnapshot = resyncStore.requestFullSnapshot

  function onRoomSnapshot(snapshot: RoomSnapshot): void {
    const current = roomStore.room
    // 快照门禁只可能 accept | ignore（resync 语义归绘图增量，见 snapshot-gate.ts 头注释），
    // 非 accept 即丢弃，无需重同步分支。
    if (acceptRoomSnapshot(current, snapshot) !== 'accept') return
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
    } else if (
      current?.game &&
      snapshot.game &&
      current.game.gameId === snapshot.game.gameId &&
      current.game.roundId === snapshot.game.roundId &&
      current.game.drawingRevision === snapshot.game.drawingRevision &&
      current.game.lastSequence === snapshot.game.lastSequence
    ) {
      // 绘图修订与序号均未前进：内容是权威相同的，复用本地数组引用，
      // 避免聊天/成员变化等纯展示快照让画布整块重投影。
      snapshot = { ...snapshot, game: { ...snapshot.game, strokes: current.game.strokes } }
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

  return { onRoomSnapshot, onStroke, onFill }
}
