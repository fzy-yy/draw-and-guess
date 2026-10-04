import { expectTypeOf } from 'vitest'
import {
  CLIENT_REQUEST_SCHEMAS,
  CLIENT_RESPONSE_SCHEMAS,
  EVENTS,
  createServerPush,
  type ClientRequestPayload,
  type ClientResponse,
  type ClientResponseAck,
  type ErrorCode,
  type Invite,
  type PresenceSnapshot,
  type RelayShowcase,
  type RelayVoteChoice,
  type RoomSnapshot,
  type ServerPushData,
  type ServerToClientEvents,
} from '@draw-guess/shared'
import { decodeServerPush } from '../../apps/client/src/stores/push-protocol.ts'

declare const raw: unknown

// 请求与响应 Schema 注册表必须一一对应：任一表漏登记事件都会在编译期失败。
expectTypeOf<keyof typeof CLIENT_REQUEST_SCHEMAS>().toEqualTypeOf<
  keyof typeof CLIENT_RESPONSE_SCHEMAS
>()

// 响应类型完全由 ack Schema 推导，不是手写接口。
expectTypeOf<ClientResponse<typeof EVENTS.networkPing>>().toEqualTypeOf<{
  clientTime: number
  serverTime: number
}>()
expectTypeOf<ClientResponse<typeof EVENTS.gameStart>>().toEqualTypeOf<RoomSnapshot>()
expectTypeOf<ClientResponse<typeof EVENTS.inviteRespond>>().toEqualTypeOf<
  RoomSnapshot | undefined
>()
expectTypeOf<ClientResponse<typeof EVENTS.stateResync>>().toEqualTypeOf<RoomSnapshot | undefined>()
expectTypeOf<ClientResponse<typeof EVENTS.roomLeave>>().toEqualTypeOf<void | undefined>()

type PingAck = ClientResponseAck<typeof EVENTS.networkPing>
const pingAck: PingAck = { ok: true, data: { clientTime: 1, serverTime: 2 }, requestId: 'request' }
void pingAck
const invalidPingAck: PingAck = {
  ok: false,
  error: {
    // @ts-expect-error 未登记的错误码不能进入响应边界
    code: 'NOT_REGISTERED',
    message: 'invalid',
  },
  requestId: 'request',
}
void invalidPingAck
const wrongPingAck: PingAck = {
  ok: true,
  // @ts-expect-error 成功 ack 的 data 必须匹配事件响应 Schema
  data: { clientTime: 1 },
  requestId: 'request',
}
void wrongPingAck

type ResponseFailureCode = Extract<
  ClientResponseAck<typeof EVENTS.roomList>,
  { ok: false }
>['error']['code']
expectTypeOf<ResponseFailureCode>().toEqualTypeOf<ErrorCode>()

declare const leaveData: ClientResponse<typeof EVENTS.roomLeave>
// @ts-expect-error room:leave 是空响应，不能被当作房间快照读取
const invalidLeave: RoomSnapshot = leaveData
void invalidLeave

const presence = decodeServerPush(EVENTS.presenceSnapshot, raw)
if (presence.ok) expectTypeOf(presence.data).toEqualTypeOf<PresenceSnapshot>()

const room = decodeServerPush(EVENTS.roomSnapshot, raw)
if (room.ok) {
  expectTypeOf(room.data).toEqualTypeOf<RoomSnapshot>()
  expectTypeOf<RoomSnapshot['members'][number]['rematchReady']>().toEqualTypeOf<boolean>()
  // @ts-expect-error room:snapshot 不可能解码成邀请 payload
  const invite: Invite = room.data
  void invite
}

expectTypeOf<ServerPushData<typeof EVENTS.inviteReceived>>().toEqualTypeOf<Invite>()

type NoticeEnvelope = Parameters<ServerToClientEvents[typeof EVENTS.systemNotice]>[0]
const notice = createServerPush(EVENTS.systemNotice, { text: 'ok' }) satisfies NoticeEnvelope
void notice

declare function emitPush<E extends keyof ServerToClientEvents>(
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void
emitPush(EVENTS.systemNotice, createServerPush(EVENTS.systemNotice, { text: 'ok' }))

const wrongNotice = createServerPush(
  EVENTS.systemNotice,
  // @ts-expect-error system:notice 的 data 必须是 { text: string }
  { reason: 'wrong event payload' },
) satisfies NoticeEnvelope
void wrongNotice
// @ts-expect-error event 与 envelope data 错配时必须在编译期失败
emitPush(EVENTS.systemNotice, createServerPush(EVENTS.systemNotice, { reason: 'wrong' }))

type RoomEnvelope = Parameters<ServerToClientEvents[typeof EVENTS.roomSnapshot]>[0]
const wrongRoom = createServerPush(
  EVENTS.roomSnapshot,
  // @ts-expect-error room:snapshot 不能接受 presence:snapshot 的 data
  { players: [], rooms: [] },
) satisfies RoomEnvelope
void wrongRoom

type RoomClosedEnvelope = Parameters<ServerToClientEvents[typeof EVENTS.roomClosed]>[0]
const roomClosed = createServerPush(EVENTS.roomClosed, {
  reason: '任意展示文案',
  code: 'kicked',
}) satisfies RoomClosedEnvelope
void roomClosed
const wrongRoomClosed: RoomClosedEnvelope = createServerPush(EVENTS.roomClosed, {
  reason: '任意展示文案',
  // @ts-expect-error room:closed 必须携带登记过的稳定关闭码，禁止用未登记的字符串
  code: 'unknown',
})
void wrongRoomClosed

// —— 接龙契约（S30 / S51 / S57 / S63 / S79）：请求载荷、ack 与视图字段的编译期配对 ——
declare const relayUndoPayload: ClientRequestPayload<typeof EVENTS.relayDrawUndo>
expectTypeOf(relayUndoPayload).toEqualTypeOf<{ requestId: string; stepId: string }>()
declare const relayGuessPayload: ClientRequestPayload<typeof EVENTS.relaySubmitGuess>
expectTypeOf(relayGuessPayload).toEqualTypeOf<{ requestId: string; stepId: string; text: string }>()
declare const relayChatPayload: ClientRequestPayload<typeof EVENTS.chatSay>
expectTypeOf(relayChatPayload).toEqualTypeOf<{ requestId: string; text: string }>()

// 猜词不判对错：提交与独立聊天都是空响应；绘图族沿用经典绘图 ack 口径
expectTypeOf<ClientResponse<typeof EVENTS.relaySubmitDrawing>>().toEqualTypeOf<void | undefined>()
expectTypeOf<ClientResponse<typeof EVENTS.chatSay>>().toEqualTypeOf<void | undefined>()
expectTypeOf<ClientResponse<typeof EVENTS.relayDrawStrokeBatch>>().toEqualTypeOf<{
  strokeId: string
  pointCount: number
  drawingRevision: number
  remainingBudget: number
}>()

// 接龙视图由 schema 推导：模式、步骤、半场与未揭晓答案的 null 表达
expectTypeOf<RoomSnapshot['gameMode']>().toEqualTypeOf<'classic' | 'relay'>()
declare const relayView: NonNullable<RoomSnapshot['relay']>
expectTypeOf(relayView.currentStep).toEqualTypeOf<1 | 2 | 3 | 4>()
expectTypeOf<NonNullable<RoomSnapshot['relay']>['phase']>().toEqualTypeOf<
  'relay_choose' | 'relay_draw' | 'relay_guess' | 'relay_showcase' | 'relay_vote'
>()
expectTypeOf<RelayShowcase['half']>().toEqualTypeOf<1 | 2>()
expectTypeOf<RelayShowcase['answer']['text']>().toEqualTypeOf<string | null>()
expectTypeOf<RelayVoteChoice>().toEqualTypeOf<'agree' | 'disagree'>()

// 负向 1：经典 roundId 不是接龙载荷的一部分（stepId 才是唯一定位字段）
expectTypeOf<ClientRequestPayload<typeof EVENTS.relayDrawUndo>>().not.toHaveProperty('roundId')
// 负向 2：视图没有「未揭晓答案长度」「其余链内容」这类隐私字段
expectTypeOf<NonNullable<RoomSnapshot['relay']>>().not.toHaveProperty('answerLength')
expectTypeOf<NonNullable<RoomSnapshot['relay']>>().not.toHaveProperty('otherChains')
// 负向 3：越界键在对象字面量上直接编译失败（strict 边界）
const relayLeak: NonNullable<RoomSnapshot['relay']> = {
  ...relayView,
  // @ts-expect-error 未揭晓答案的长度绝不下发（S63 / S81）
  answerLength: 2,
}
void relayLeak
