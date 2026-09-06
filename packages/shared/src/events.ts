/**
 * 前后端共享协议、运行时校验与无环境依赖领域纯函数。
 * 此模块只描述可公开的数据结构，绝不声明服务端秘密答案容器或密码字段。
 */
import type {
  FillPush,
  Invite,
  MemberConnectionChange,
  PresenceSnapshot,
  PublicRoom,
  RoomSnapshot,
  ServerPushEnvelope,
  StrokePush,
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

/** Socket.IO 服务端主动推送类型图；每项都强制使用版本化信封。 */
export interface ServerToClientEvents {
  [EVENTS.presenceSnapshot]: (payload: ServerPushEnvelope<PresenceSnapshot>) => void
  [EVENTS.roomListChanged]: (payload: ServerPushEnvelope<PublicRoom[]>) => void
  [EVENTS.inviteReceived]: (payload: ServerPushEnvelope<Invite>) => void
  [EVENTS.inviteResolved]: (payload: ServerPushEnvelope<{ id: string; status: string }>) => void
  [EVENTS.roomSnapshot]: (payload: ServerPushEnvelope<RoomSnapshot>) => void
  [EVENTS.roomMemberConnectionChanged]: (
    payload: ServerPushEnvelope<MemberConnectionChange>,
  ) => void
  [EVENTS.roomClosed]: (payload: ServerPushEnvelope<{ reason: string }>) => void
  [EVENTS.systemNotice]: (payload: ServerPushEnvelope<{ text: string }>) => void
  [EVENTS.systemError]: (payload: ServerPushEnvelope<{ text: string }>) => void
  [EVENTS.drawStrokeBatch]: (payload: ServerPushEnvelope<StrokePush>) => void
  [EVENTS.drawFillCommit]: (payload: ServerPushEnvelope<FillPush>) => void
}
