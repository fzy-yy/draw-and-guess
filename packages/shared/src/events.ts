/**
 * 前后端共享协议、运行时校验与无环境依赖领域纯函数。
 * 此模块只描述可公开的数据结构，绝不声明服务端秘密答案容器或密码字段。
 */

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
  roomSetReady: 'room:setReady',
  roomKick: 'room:kick',
  roomTransferHost: 'room:transferHost',
  inviteSend: 'invite:send',
  inviteRespond: 'invite:respond',
  gameStart: 'game:start',
  gameChooseWord: 'game:chooseWord',
  gamePauseRequest: 'game:pauseRequest',
  gameResume: 'game:resume',
  gameEndEarly: 'game:endEarly',
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
  sessionReady: 'session:ready',
  presenceSnapshot: 'presence:snapshot',
  roomListChanged: 'room:listChanged',
  inviteReceived: 'invite:received',
  inviteResolved: 'invite:resolved',
  roomSnapshot: 'room:snapshot',
  roomVocabularySnapshot: 'room:vocabularySnapshot',
  roomClosed: 'room:closed',
  gameWordOptions: 'game:wordOptions',
  guessMessage: 'guess:message',
  guessClose: 'guess:close',
  guessCorrect: 'guess:correct',
  systemNotice: 'system:notice',
  systemError: 'system:error',
  networkPong: 'network:pong',
} as const
