import { APP_CONFIG } from '../../config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import type { Invite, RoomSnapshot } from '@draw-guess/shared'
import { GameError } from '../../errors.ts'
import type { InviteSecret, PlayerSecret, RoomSecret } from '../../models.ts'
import type { RuntimeDependencies } from '../../runtime.ts'

type InviteStatus = 'accepted' | 'declined' | 'expired'

export interface InviteContext {
  invites: Map<string, InviteSecret>
  clock: RuntimeDependencies['clock']
  scheduler: RuntimeDependencies['scheduler']
  random: RuntimeDependencies['random']
  getMembership(playerId: string): { room: RoomSecret }
  getPlayer(playerId: string): PlayerSecret
  getRoom(roomId: string): RoomSecret | undefined
  join(playerId: string, room: RoomSecret): RoomSnapshot
  toPublicInvite(invite: InviteSecret): Invite
  emitInvite(target: PlayerSecret, invite: Invite): void
  emitResolved(invite: InviteSecret, id: string, status: InviteStatus): void
  safeRun(label: string, action: () => void): void
}

/** 定向邀请的授权、冷却、过期与一次性消费用例。 */
export class InviteService {
  constructor(private readonly context: InviteContext) {}

  send(playerId: string, targetId: string): Invite {
    const { room } = this.context.getMembership(playerId)
    const sender = this.context.getPlayer(playerId)
    const target = this.context.getPlayer(targetId)
    if (room.phase !== 'waiting' || room.members.length >= room.settings.maxPlayers)
      throw new GameError('ROOM_NOT_JOINABLE', serverStrings.errors.ROOM_NOT_JOINABLE_INVITE)
    if (room.hostId !== playerId && !room.settings.allowPlayerInvite)
      throw new GameError('FORBIDDEN', serverStrings.errors.FORBIDDEN_INVITE)
    if (
      !target.connected ||
      target.roomId ||
      !target.preferences.acceptsInvites ||
      room.members.some((member) => member.playerId === targetId && member.leftGame)
    )
      throw new GameError('TARGET_UNAVAILABLE', serverStrings.errors.TARGET_UNAVAILABLE)
    const last = sender.lastInviteAt.get(targetId) ?? 0
    if (this.context.clock.now() - last < APP_CONFIG.network.inviteCooldownMs)
      throw new GameError('RATE_LIMITED', serverStrings.errors.RATE_LIMITED_INVITE)
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

  respond(playerId: string, inviteId: string, accept: boolean): RoomSnapshot | undefined {
    const invite = this.context.invites.get(inviteId)
    if (!invite || invite.toPlayerId !== playerId || invite.expiresAt < this.context.clock.now())
      throw new GameError('INVITE_EXPIRED', serverStrings.errors.INVITE_EXPIRED)
    const room = this.context.getRoom(invite.roomId)
    if (!accept) {
      this.resolve(inviteId, 'declined')
      return undefined
    }
    if (!room) {
      this.resolve(inviteId, 'declined')
      throw new GameError('ROOM_NOT_FOUND', serverStrings.errors.ROOM_NOT_FOUND_INVITE)
    }
    const snapshot = this.context.join(playerId, room)
    this.resolve(inviteId, 'accepted')
    return snapshot
  }

  resolve(id: string, status: InviteStatus): void {
    const invite = this.context.invites.get(id)
    if (!invite) return
    this.context.scheduler.clear(invite.timer)
    this.context.invites.delete(id)
    this.context.emitResolved(invite, id, status)
  }
}
