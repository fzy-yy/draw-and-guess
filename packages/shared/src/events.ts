/**
 * Socket.IO 事件名与请求/响应类型契约（前后端唯一事件名来源）。
 * 本文件只描述可公开的数据结构，绝不声明服务端秘密答案容器或密码字段。
 */
import { z } from 'zod'
import { ProfileSchema, RequestSchema } from './protocol/base.ts'
import { FillCommandSchema, StrokeSchema } from './protocol/drawing.ts'
import {
  ChooseWordSchema,
  GuessWordSchema,
  PauseGameSchema,
  RerollWordsSchema,
  CustomWordSchema,
  CanvasPingPayloadSchema,
  SendPresetSchema,
  StartGameSchema,
} from './protocol/gameplay.ts'
import { RespondInviteSchema, SendInviteSchema } from './protocol/invite.ts'
import {
  RelayDrawingRoundSchema,
  SendChatSchema,
  SubmitDrawingSchema,
  SubmitGuessSchema,
} from './protocol/relay.ts'
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
import type { ClientResponseData } from './protocol/response.ts'
import type { Ack } from './types/index.ts'

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
  gameCustomWord: 'game:customWord',
  gamePauseRequest: 'game:pauseRequest',
  gameResume: 'game:resume',
  gameEndEarly: 'game:endEarly',
  gameLeave: 'game:leave',
  gameReturnWaiting: 'game:returnWaiting',
  guessSubmit: 'guess:submit',
  chatPreset: 'chat:preset',
  /* 接龙专属请求事件（S51 / S30 / S79）：绘图族用 stepId 定位本步画布，提交拆成猜词/作画两条，聊天独立。 */
  relayDrawStrokeBatch: 'relay:drawStrokeBatch',
  relayDrawFillCommit: 'relay:drawFillCommit',
  relayDrawUndo: 'relay:drawUndo',
  relayDrawRedo: 'relay:drawRedo',
  relayDrawClear: 'relay:drawClear',
  relaySubmitGuess: 'relay:submitGuess',
  relaySubmitDrawing: 'relay:submitDrawing',
  chatSay: 'chat:say',
  gameCanvasPing: 'game:canvas_ping',
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
  [EVENTS.gameCustomWord]: CustomWordSchema,
  [EVENTS.gamePauseRequest]: PauseGameSchema,
  [EVENTS.gameResume]: RequestSchema,
  [EVENTS.gameEndEarly]: RequestSchema,
  [EVENTS.gameLeave]: RequestSchema,
  [EVENTS.gameReturnWaiting]: RequestSchema,
  [EVENTS.guessSubmit]: GuessWordSchema,
  [EVENTS.chatPreset]: SendPresetSchema,
  /* 接龙请求：绘图族共用一个「带 stepId」的载荷 Schema，两条提交与独立聊天各自登记。 */
  [EVENTS.relayDrawStrokeBatch]: RelayDrawingRoundSchema.extend({
    stroke: StrokeSchema,
  }),
  [EVENTS.relayDrawFillCommit]: RelayDrawingRoundSchema.extend({ fill: FillCommandSchema }),
  [EVENTS.relayDrawUndo]: RelayDrawingRoundSchema,
  [EVENTS.relayDrawRedo]: RelayDrawingRoundSchema,
  [EVENTS.relayDrawClear]: RelayDrawingRoundSchema,
  [EVENTS.relaySubmitGuess]: SubmitGuessSchema,
  [EVENTS.relaySubmitDrawing]: SubmitDrawingSchema,
  [EVENTS.chatSay]: SendChatSchema,
  [EVENTS.gameCanvasPing]: CanvasPingPayloadSchema,
  [EVENTS.drawStrokeBatch]: DrawingRoundSchema.extend({ stroke: StrokeSchema }),
  [EVENTS.drawFillCommit]: DrawingRoundSchema.extend({ fill: FillCommandSchema }),
  [EVENTS.drawUndo]: DrawingRoundSchema,
  [EVENTS.drawRedo]: DrawingRoundSchema,
  [EVENTS.drawClear]: DrawingRoundSchema,
  [EVENTS.stateResync]: StateResyncSchema,
  [EVENTS.networkPing]: RequestSchema.extend({ clientTime: z.number() }),
} as const

/**
 * 响应数据完全由 `protocol/response.ts` 的 ack Schema 推导：
 * 请求 payload 走 `CLIENT_REQUEST_SCHEMAS`，ack 走 `CLIENT_RESPONSE_SCHEMAS`，
 * 两者共同组成请求事件全集，避免手写响应接口与运行时线格式漂移。
 * 两张注册表事件集必须一致——该约束由 `test/type/schema-first.ts` 的编译期
 * `expectTypeOf<keyof ...>().toEqualTypeOf<keyof ...>()` 断言把关（不等则 CI 类型检查失败），
 * 因此这里无需再用交集重复表达。
 */
export type ClientRequestEvent = keyof typeof CLIENT_REQUEST_SCHEMAS
export type ClientRequestPayload<E extends ClientRequestEvent> = z.infer<
  (typeof CLIENT_REQUEST_SCHEMAS)[E]
>
export type ClientResponse<E extends ClientRequestEvent> = ClientResponseData<E>
export type ClientToServerEvents = {
  [E in ClientRequestEvent]: (
    payload: ClientRequestPayload<E>,
    ack: (response: Ack<ClientResponse<E>>) => void,
  ) => void
}
