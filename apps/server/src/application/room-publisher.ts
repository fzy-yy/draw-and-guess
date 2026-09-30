import {
  EVENTS,
  createServerPush,
  type PresenceSnapshot,
  type RoomSnapshot,
} from '@draw-guess/shared'
import type { RuntimeLogContext } from '../errors.ts'
import type { PlayerSecret, RoomSecret } from '../models.ts'
import type { AppServer } from '../socket-types.ts'

export interface RoomPublisherContext {
  io: AppServer
  rooms: Map<string, RoomSecret>
  players: Map<string, PlayerSecret>
  /** 生成观看者视角快照；forceFull 由构建器内部作废差分游标（调用方不触碰领域状态）。 */
  snapshot(room: RoomSecret, viewerId: string, options?: { forceFull?: boolean }): RoomSnapshot
  toPublicPlayer(player: PlayerSecret): PresenceSnapshot['players'][number]
  toPublicRoom(room: RoomSecret): PresenceSnapshot['rooms'][number]
  /** 日志上下文走静态白名单类型（RuntimeLogContext），拒绝任意键写入。 */
  logError(error: unknown, context: RuntimeLogContext): void
}

/** 角色裁剪快照与大厅状态发布端口。 */
export class RoomPublisher {
  constructor(private readonly context: RoomPublisherContext) {}

  emitRoom(roomId: string): void {
    const room = this.context.rooms.get(roomId)
    if (!room) return
    for (const member of room.members) {
      if (member.leftGame) continue
      try {
        const player = this.context.players.get(member.playerId)
        player?.socket?.emit(
          EVENTS.roomSnapshot,
          createServerPush(EVENTS.roomSnapshot, this.context.snapshot(room, member.playerId)),
        )
      } catch (error) {
        // 原字段名 memberId 不在日志白名单（会被 sanitizeContext 静默丢弃），
        // 其值本就是玩家 ID，改用 playerId 让诊断信息真正可查。
        this.context.logError(error, { roomId, playerId: member.playerId, scope: 'emitRoom' })
      }
    }
  }

  presenceSnapshot(): PresenceSnapshot {
    const players = [...this.context.players.values()]
      .filter((player) => player.preferences.discoverable)
      .map((player) => this.context.toPublicPlayer(player))
    const rooms = [...this.context.rooms.values()]
      .filter((room) => room.visibility === 'public')
      .map((room) => this.context.toPublicRoom(room))
    return { players, rooms }
  }

  broadcastPresence(): void {
    const snapshot = this.presenceSnapshot()
    this.context.io.emit(
      EVENTS.presenceSnapshot,
      createServerPush(EVENTS.presenceSnapshot, snapshot),
    )
    this.context.io.emit(
      EVENTS.roomListChanged,
      createServerPush(EVENTS.roomListChanged, snapshot.rooms),
    )
  }

  snapshotForPlayer(playerId: string, forceFull = false): RoomSnapshot | undefined {
    const player = this.context.players.get(playerId)
    const room = player?.roomId ? this.context.rooms.get(player.roomId) : undefined
    if (!player || !room) return undefined
    // 强制全量经快照构建器内部作废差分游标（应用层不再直接改写领域绘图状态）。
    return this.context.snapshot(room, playerId, { forceFull })
  }
}
