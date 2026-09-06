import type { RoomSnapshot } from '@draw-guess/shared'

export type PushDecision = 'accept' | 'ignore' | 'resync'

/**
 * 房间快照统一门禁：拒绝旧房间、旧状态、旧对局、旧回合与画布修订倒退。
 * 相同 stateVersion 仍可接收，因为聊天/绘图等高频状态不会为每条消息增加房间版本。
 */
export function acceptRoomSnapshot(
  current: RoomSnapshot | undefined,
  incoming: RoomSnapshot,
): PushDecision {
  if (!current) return 'accept'
  if (incoming.id !== current.id) return 'ignore'
  if (incoming.stateVersion < current.stateVersion) return 'ignore'

  const currentGame = current.game
  const incomingGame = incoming.game
  if (!currentGame) return 'accept'
  if (!incomingGame) return incoming.stateVersion > current.stateVersion ? 'accept' : 'ignore'
  if (incomingGame.gameId !== currentGame.gameId)
    return incoming.stateVersion > current.stateVersion ? 'accept' : 'ignore'
  if (incomingGame.currentRound < currentGame.currentRound) return 'ignore'
  if (
    incomingGame.roundId !== currentGame.roundId &&
    incomingGame.currentRound <= currentGame.currentRound
  )
    return 'ignore'
  if (
    incomingGame.roundId === currentGame.roundId &&
    incomingGame.drawingRevision < currentGame.drawingRevision
  )
    return 'ignore'
  return 'accept'
}

export interface DrawingIncrementMeta {
  roomId: string
  gameId: string
  roundId: string
  drawingRevision: number
}

/** 绘图增量必须属于当前房间/对局/回合，并严格接续 drawingRevision。 */
export function acceptDrawingIncrement(
  current: RoomSnapshot | undefined,
  incoming: DrawingIncrementMeta,
): PushDecision {
  const game = current?.game
  if (!current || !game) return 'resync'
  if (incoming.roomId !== current.id) return 'ignore'
  if (incoming.gameId !== game.gameId || incoming.roundId !== game.roundId) return 'ignore'
  if (incoming.drawingRevision <= game.drawingRevision) return 'ignore'
  if (incoming.drawingRevision !== game.drawingRevision + 1) return 'resync'
  return 'accept'
}
