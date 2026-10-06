/**
 * 房间定向邀请领域服务。
 *
 * 遵循《后端架构规范》R3.2 与 R4.3：
 * 1. 负责向大厅空闲在线玩家发起定向邀请、受限冷却、自动超时及接受/拒绝处理；
 * 2. 状态校验：容量限制、房间阶段限制、黑名单与免打扰偏好；
 * 3. 错误全量采用 AppError 抛出。
 */
import { APP_CONFIG } from '../../core/config.ts'
import { serverStrings } from '@draw-guess/strings'
import {
  ERROR_CODES,
  PLAYER_PROTOCOL_LIMITS,
  type Invite,
  type RoomSnapshot,
} from '@draw-guess/shared'
import {
  ConflictError,
  ForbiddenError,
  GameError,
  NotFoundError,
  RateLimitError,
} from '../../core/errors.ts'
import type { InviteSecret, PlayerSecret, RoomSecret } from '../../models.ts'
import type { RuntimePorts } from '../../domain/shared-ports.ts'

export type InviteStatus = 'accepted' | 'declined' | 'expired'

/**
 * 邀请服务运行期所需依赖与跨模块出口上下文契约。
 */
export interface InviteContext extends RuntimePorts {
  invites: Map<string, InviteSecret>
  getMembership(playerId: string): { room: RoomSecret }
  getPlayer(playerId: string): PlayerSecret
  getRoom(roomId: string): RoomSecret | undefined
  join(playerId: string, room: RoomSecret): RoomSnapshot
  toPublicInvite(invite: InviteSecret): Invite
  emitInvite(target: PlayerSecret, invite: Invite): void
  emitResolved(invite: InviteSecret, id: string, status: InviteStatus): void
  safeRun(label: string, action: () => void): void
}

/**
 * 房间定向邀请服务。
 */
export class InviteService {
  constructor(private readonly context: InviteContext) {}

  /**
   * 发送定向对局邀请。
   */
  send(playerId: string, targetId: string): Invite {
    const { room } = this.context.getMembership(playerId)
    const sender = this.context.getPlayer(playerId)
    const target = this.context.getPlayer(targetId)

    if (room.phase !== 'waiting' || room.members.length >= PLAYER_PROTOCOL_LIMITS.maxPlayers) {
      throw new ConflictError(
        serverStrings.errors.ROOM_NOT_JOINABLE_INVITE,
        ERROR_CODES.ROOM_NOT_JOINABLE,
      )
    }

    if (room.hostId !== playerId && !room.settings.allowPlayerInvite) {
      throw new ForbiddenError(serverStrings.errors.FORBIDDEN_INVITE, ERROR_CODES.FORBIDDEN)
    }

    if (
      !target.connected ||
      target.roomId ||
      !target.preferences.acceptsInvites ||
      room.members.some((member) => member.playerId === targetId && member.leftGame)
    ) {
      throw new ConflictError(
        serverStrings.errors.TARGET_UNAVAILABLE,
        ERROR_CODES.TARGET_UNAVAILABLE,
      )
    }

    const last = sender.lastInviteAt.get(targetId) ?? 0
    if (this.context.clock.now() - last < APP_CONFIG.network.inviteCooldownMs) {
      throw new RateLimitError(serverStrings.errors.RATE_LIMITED_INVITE)
    }
    sender.lastInviteAt.set(targetId, this.context.clock.now())

    const id = this.context.random.uuid()
    const invite: InviteSecret = {
      id,
      fromPlayerId: playerId,
      toPlayerId: targetId,
      roomId: room.id,
      expiresAt: this.context.clock.now() + APP_CONFIG.network.inviteExpiryMs,
      timer: this.context.scheduler.set(APP_CONFIG.network.inviteExpiryMs, () =>
        this.context.safeRun('inviteExpiry', () => this.resolve(id, 'expired')),
      ),
    }

    this.context.invites.set(id, invite)
    const publicInvite = this.context.toPublicInvite(invite)
    this.context.emitInvite(target, publicInvite)
    return publicInvite
  }

  /**
   * 响应（接受或拒绝）定向邀请。
   */
  respond(playerId: string, inviteId: string, accept: boolean): RoomSnapshot | undefined {
    const invite = this.context.invites.get(inviteId)
    if (!invite || invite.toPlayerId !== playerId || invite.expiresAt < this.context.clock.now()) {
      throw new GameError(
        ERROR_CODES.INVITE_EXPIRED,
        serverStrings.errors.INVITE_EXPIRED,
        undefined,
        410,
      )
    }

    const room = this.context.getRoom(invite.roomId)
    if (!accept) {
      this.resolve(inviteId, 'declined')
      return undefined
    }

    if (!room) {
      this.resolve(inviteId, 'declined')
      throw new NotFoundError(
        serverStrings.errors.ROOM_NOT_FOUND_INVITE,
        ERROR_CODES.ROOM_NOT_FOUND,
      )
    }

    const snapshot = this.context.join(playerId, room)
    this.resolve(inviteId, 'accepted')
    return snapshot
  }

  /**
   * 结算并清理已完成或已超期的邀请记录。
   */
  resolve(id: string, status: InviteStatus): void {
    const invite = this.context.invites.get(id)
    if (!invite) return
    this.context.scheduler.clear(invite.timer)
    this.context.invites.delete(id)
    this.context.emitResolved(invite, id, status)
  }
}
