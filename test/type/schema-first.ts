import { expectTypeOf } from 'vitest'
import {
  EVENTS,
  createServerPush,
  type Invite,
  type PresenceSnapshot,
  type RoomSnapshot,
  type ServerPushData,
  type ServerToClientEvents,
} from '@draw-guess/shared'
import { decodeServerPush } from '../../apps/client/src/stores/push-protocol.ts'

declare const raw: unknown

const presence = decodeServerPush(EVENTS.presenceSnapshot, raw)
if (presence.ok) expectTypeOf(presence.data).toEqualTypeOf<PresenceSnapshot>()

const room = decodeServerPush(EVENTS.roomSnapshot, raw)
if (room.ok) {
  expectTypeOf(room.data).toEqualTypeOf<RoomSnapshot>()
  expectTypeOf<RoomSnapshot['members'][number]['waitingForNextGame']>().toEqualTypeOf<boolean>()
  expectTypeOf<RoomSnapshot['members'][number]['rematchReady']>().toEqualTypeOf<boolean>()
  // @ts-expect-error room:snapshot 不可能解码成邀请 payload
  const invite: Invite = room.data
  void invite
}

expectTypeOf<ServerPushData<typeof EVENTS.inviteReceived>>().toEqualTypeOf<Invite>()

type NoticeEnvelope = Parameters<ServerToClientEvents[typeof EVENTS.systemNotice]>[0]
const notice = createServerPush({ text: 'ok' }) satisfies NoticeEnvelope
void notice

declare function emitPush<E extends keyof ServerToClientEvents>(
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void
emitPush(EVENTS.systemNotice, createServerPush({ text: 'ok' }))

// @ts-expect-error system:notice 的 data 必须是 { text: string }
const wrongNotice = createServerPush({ reason: 'wrong event payload' }) satisfies NoticeEnvelope
void wrongNotice
// @ts-expect-error event 与 envelope data 错配时必须在编译期失败
emitPush(EVENTS.systemNotice, createServerPush({ reason: 'wrong event payload' }))

type RoomEnvelope = Parameters<ServerToClientEvents[typeof EVENTS.roomSnapshot]>[0]
// @ts-expect-error room:snapshot 不能接受 presence:snapshot 的 data
const wrongRoom = createServerPush({ players: [], rooms: [] }) satisfies RoomEnvelope
void wrongRoom
