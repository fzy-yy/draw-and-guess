/**
 * 前后端共享协议、运行时校验与无环境依赖领域纯函数。
 * 此模块只描述可公开的数据结构，绝不声明服务端秘密答案容器或密码字段。
 */
import { z } from 'zod'
import { ProfileSchema, RequestSchema } from './protocol/base.ts'
import { FillCommandSchema, StrokeSchema } from './protocol/drawing.ts'
import {
  ChooseWordSchema,
  GuessWordSchema,
  PauseGameSchema,
  RerollWordsSchema,
  SendPresetSchema,
  StartGameSchema,
} from './protocol/gameplay.ts'
import { RespondInviteSchema, SendInviteSchema } from './protocol/invite.ts'
import {
  CreateRoomSchema,
  JoinPrivateRoomSchema,
  JoinRoomSchema,
  KickMemberSchema,
  SetReadySchema,
  TransferHostSchema,
  UpdateRoomSettingsSchema,
} from './protocol/room.ts'
import { LogoutSchema, RegisterSchema, StateResyncSchema } from './protocol/session.ts'
import { SelectVocabularyPackageSchema, UpdateVocabularySchema } from './protocol/vocabulary.ts'
import type {
  Ack,
  Invite,
  PresenceSnapshot,
  PublicPlayer,
  PublicRoom,
  RoomSnapshot,
  SessionRegistration,
  StrokeAck,
  VocabularySnapshot,
} from './types.ts'

/**
 * 全部 Socket.IO 事件名常量表。
 *
 * 命名约定：
 * - 前缀为「方向」：`session:`/`presence:`/`room:`/`invite:`/`game:`/`guess:`/`chat:`/`draw:`/`state:`/`network:`
 *   表示客户端 → 服务端的请求事件；其余为服务端 → 客户端的推送事件。
 * - 值统一使用小写驼峰（或小写单词），保证前后端在不经过任何字符串拼接的情况下引用同一事件名。
 * - 双方代码一律引用此常量，禁止在业务代码中手写事件名字符串。
 */
export const EVENTS = {
  sessionRegister: 'session:register',
  sessionLogout: 'session:logout',
  sessionUpdateProfile: 'session:updateProfile',
  presenceGet: 'presence:get',
  presenceUpdatePreferences: 'presence:updatePreferences',
  roomList: 'room:list',
  roomCreate: 'room:create',
  roomJoin: 'room:join',
  roomJoinPrivate: 'room:joinPrivate',
  roomLeave: 'room:leave',
  roomUpdateSettings: 'room:updateSettings',
  roomGetVocabulary: 'room:getVocabulary',
  roomUpdateVocabulary: 'room:updateVocabulary',
  roomSelectVocabularyPackage: 'room:selectVocabularyPackage',
  roomSetReady: 'room:setReady',
  roomKick: 'room:kick',
  roomTransferHost: 'room:transferHost',
  inviteSend: 'invite:send',
  inviteRespond: 'invite:respond',
  gameStart: 'game:start',
  gameChooseWord: 'game:chooseWord',
  gameRerollWords: 'game:rerollWords',
  gamePauseRequest: 'game:pauseRequest',
  gameResume: 'game:resume',
  gameEndEarly: 'game:endEarly',
  gameLeave: 'game:leave',
  gameReturnWaiting: 'game:returnWaiting',
  guessSubmit: 'guess:submit',
  chatPreset: 'chat:preset',
  drawStrokeBatch: 'draw:strokeBatch',
  drawFillCommit: 'draw:fillCommit',
  drawUndo: 'draw:undo',
  drawRedo: 'draw:redo',
  drawClear: 'draw:clear',
  stateResync: 'state:resync',
  networkPing: 'network:ping',
  /* ↓↓↓ 以下均为服务端 → 客户端的推送事件（单向通知，无 ack）↓↓↓ */
  presenceSnapshot: 'presence:snapshot',
  roomListChanged: 'room:listChanged',
  inviteReceived: 'invite:received',
  inviteResolved: 'invite:resolved',
  roomSnapshot: 'room:snapshot',
  roomMemberConnectionChanged: 'room:memberConnectionChanged',
  roomClosed: 'room:closed',
  systemNotice: 'system:notice',
  systemError: 'system:error',
} as const

/** 协议事件名联合类型，禁止业务层绕过 EVENTS 手写任意字符串。 */
export type EventName = (typeof EVENTS)[keyof typeof EVENTS]

const DrawingRoundSchema = RequestSchema.extend({ roundId: z.string().uuid() })

/** 客户端请求事件到 Zod Schema 的唯一映射；payload 类型与 binder 输入均由这里推导。 */
export const CLIENT_REQUEST_SCHEMAS = {
  [EVENTS.sessionRegister]: RegisterSchema,
  [EVENTS.sessionLogout]: LogoutSchema,
  [EVENTS.sessionUpdateProfile]: RequestSchema.extend({ profile: ProfileSchema }),
  [EVENTS.presenceGet]: RequestSchema,
  [EVENTS.presenceUpdatePreferences]: RequestSchema.extend({
    discoverable: z.boolean(),
    acceptsInvites: z.boolean(),
  }),
  [EVENTS.roomList]: RequestSchema,
  [EVENTS.roomCreate]: CreateRoomSchema,
  [EVENTS.roomJoin]: JoinRoomSchema,
  [EVENTS.roomJoinPrivate]: JoinPrivateRoomSchema,
  [EVENTS.roomLeave]: RequestSchema,
  [EVENTS.roomUpdateSettings]: UpdateRoomSettingsSchema,
  [EVENTS.roomGetVocabulary]: RequestSchema,
  [EVENTS.roomUpdateVocabulary]: UpdateVocabularySchema,
  [EVENTS.roomSelectVocabularyPackage]: SelectVocabularyPackageSchema,
  [EVENTS.roomSetReady]: SetReadySchema,
  [EVENTS.roomKick]: KickMemberSchema,
  [EVENTS.roomTransferHost]: TransferHostSchema,
  [EVENTS.inviteSend]: SendInviteSchema,
  [EVENTS.inviteRespond]: RespondInviteSchema,
  [EVENTS.gameStart]: StartGameSchema,
  [EVENTS.gameChooseWord]: ChooseWordSchema,
  [EVENTS.gameRerollWords]: RerollWordsSchema,
  [EVENTS.gamePauseRequest]: PauseGameSchema,
  [EVENTS.gameResume]: RequestSchema,
  [EVENTS.gameEndEarly]: RequestSchema,
  [EVENTS.gameLeave]: RequestSchema,
  [EVENTS.gameReturnWaiting]: RequestSchema,
  [EVENTS.guessSubmit]: GuessWordSchema,
  [EVENTS.chatPreset]: SendPresetSchema,
  [EVENTS.drawStrokeBatch]: DrawingRoundSchema.extend({ stroke: StrokeSchema }),
  [EVENTS.drawFillCommit]: DrawingRoundSchema.extend({ fill: FillCommandSchema }),
  [EVENTS.drawUndo]: DrawingRoundSchema,
  [EVENTS.drawRedo]: DrawingRoundSchema,
  [EVENTS.drawClear]: DrawingRoundSchema,
  [EVENTS.stateResync]: StateResyncSchema,
  [EVENTS.networkPing]: RequestSchema.extend({ clientTime: z.number() }),
} as const

/** ack 数据仍由用例返回值定义；请求 payload 则完全由 CLIENT_REQUEST_SCHEMAS 推导。 */
export interface ClientResponseContract {
  [EVENTS.sessionRegister]: SessionRegistration
  [EVENTS.sessionLogout]: { success: true }
  [EVENTS.sessionUpdateProfile]: PublicPlayer
  [EVENTS.presenceGet]: PresenceSnapshot
  [EVENTS.presenceUpdatePreferences]: void
  [EVENTS.roomList]: PublicRoom[]
  [EVENTS.roomCreate]: RoomSnapshot
  [EVENTS.roomJoin]: RoomSnapshot
  [EVENTS.roomJoinPrivate]: RoomSnapshot
  [EVENTS.roomLeave]: void
  [EVENTS.roomUpdateSettings]: RoomSnapshot
  [EVENTS.roomGetVocabulary]: VocabularySnapshot
  [EVENTS.roomUpdateVocabulary]: VocabularySnapshot
  [EVENTS.roomSelectVocabularyPackage]: VocabularySnapshot
  [EVENTS.roomSetReady]: RoomSnapshot
  [EVENTS.roomKick]: void
  [EVENTS.roomTransferHost]: void
  [EVENTS.inviteSend]: Invite
  [EVENTS.inviteRespond]: RoomSnapshot | undefined
  [EVENTS.gameStart]: RoomSnapshot
  [EVENTS.gameChooseWord]: void
  [EVENTS.gameRerollWords]: void
  [EVENTS.gamePauseRequest]: void
  [EVENTS.gameResume]: void
  [EVENTS.gameEndEarly]: void
  [EVENTS.gameLeave]: void
  [EVENTS.gameReturnWaiting]: void
  [EVENTS.guessSubmit]: { correct: boolean }
  [EVENTS.chatPreset]: void
  [EVENTS.drawStrokeBatch]: StrokeAck
  [EVENTS.drawFillCommit]: void
  [EVENTS.drawUndo]: void
  [EVENTS.drawRedo]: void
  [EVENTS.drawClear]: void
  [EVENTS.stateResync]: RoomSnapshot | undefined
  [EVENTS.networkPing]: { clientTime: number; serverTime: number }
}

export type ClientRequestEvent = keyof typeof CLIENT_REQUEST_SCHEMAS & keyof ClientResponseContract
export type ClientRequestPayload<E extends ClientRequestEvent> = z.infer<
  (typeof CLIENT_REQUEST_SCHEMAS)[E]
>
export type ClientResponse<E extends ClientRequestEvent> = ClientResponseContract[E]
export type ClientToServerEvents = {
  [E in ClientRequestEvent]: (
    payload: ClientRequestPayload<E>,
    ack: (response: Ack<ClientResponse<E>>) => void,
  ) => void
}
