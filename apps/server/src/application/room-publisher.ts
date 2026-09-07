import {
  EVENTS,
  createServerPush,
  type PresenceSnapshot,
  type RoomSnapshot,
} from '@draw-guess/shared'
import type { PlayerSecret, RoomSecret } from '../models.ts'

export interface RoomPublisherContext {
  io: import('socket.io').Server
  rooms: Map<string, RoomSecret>
  players: Map<string, PlayerSecret>
  snapshot(room: RoomSecret, viewerId: string): RoomSnapshot
  toPublicPlayer(player: PlayerSecret): PresenceSnapshot['players'][number]
  toPublicRoom(room: RoomSecret): PresenceSnapshot['rooms'][number]
  logError(error: unknown, context: Record<string, unknown>): void
}

/** 角色裁剪快照与大厅状态发布端口。 */
export class RoomPublisher {
  constructor(private readonly context: RoomPublisherContext) {}

  emitRoom(roomId?: string): void {
    if (!roomId) return
    const room = this.context.rooms.get(roomId)
    if (!room) return
    for (const member of room.members) {
      if (member.leftGame) continue
      try {
        const player = this.context.players.get(member.playerId)
        player?.socket?.emit(
          EVENTS.roomSnapshot,
          createServerPush(this.context.snapshot(room, member.playerId)),
        )
      } catch (error) {
        this.context.logError(error, { roomId, memberId: member.playerId, scope: 'emitRoom' })
      }
    }
  }

  presenceSnapshot(): PresenceSnapshot {
    const players = [...this.context.players.values()]
      .filter((player) => player.preferences.discoverable)
      .map((player) => this.context.toPublicPlayer(player))
    const rooms = [...this.context.rooms.values()]
      .filter((room) => room.visibility === 'public' && room.phase !== 'closed')
      .map((room) => this.context.toPublicRoom(room))
    return { players, rooms }
  }

  broadcastPresence(): void {
    const snapshot = this.presenceSnapshot()
    this.context.io.emit(EVENTS.presenceSnapshot, createServerPush(snapshot))
    this.context.io.emit(EVENTS.roomListChanged, createServerPush(snapshot.rooms))
  }

  snapshotForPlayer(playerId: string, forceFull = false): RoomSnapshot | undefined {
    const player = this.context.players.get(playerId)
    const room = player?.roomId ? this.context.rooms.get(player.roomId) : undefined
    if (!player || !room) return undefined
    const member = room.members.find((item) => item.playerId === playerId)
    if (forceFull && member) member.lastSyncedSeq = undefined
    return this.context.snapshot(room, playerId)
  }
}
