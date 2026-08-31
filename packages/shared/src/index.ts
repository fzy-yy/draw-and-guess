/**
 * 前后端共享协议、运行时校验与无环境依赖领域纯函数。
 * 此模块只描述可公开的数据结构，绝不声明服务端秘密答案容器或密码字段。
 */
import { z } from 'zod'
import { APP_CONFIG } from '../../../config.ts'

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

/** 房间所处的对局阶段；服务端状态机只允许发生显式合法的转换。 */
export type RoomPhase =
  | 'waiting' // 等待阶段：可加入、可改规则、可准备
  | 'starting' // 开始倒计时中（短暂过渡阶段）
  | 'choosing_word' // 画家正在从候选词中选题
  | 'drawing' // 作画与猜词阶段
  | 'round_result' // 单回合结算展示阶段
  | 'paused' // 全局暂停（所有计时冻结）
  | 'game_result' // 最终结算展示阶段
  | 'closed' // 房间已关闭（不可再加入）

/** 成员与服务器的连接状态（仅表示是否在线，与玩家在场状态无关）。 */
export type ConnectionState = 'online' | 'reconnecting'
/** 玩家在场状态：空闲 / 在房间中 / 正在对局 / 断线恢复宽限期。 */
export type PresenceStatus = 'idle' | 'in_room' | 'playing' | 'reconnecting'
/** 画布工具类型：画笔、橡皮擦、封闭区域填充。 */
export type ToolKind = 'pen' | 'eraser' | 'fill'

/** 玩家的公开身份资料：昵称 + 纯色圆形头像颜色。 */
export interface Profile {
  nickname: string
  avatarColor: string
}

/** 玩家的公开发现偏好：是否允许被其他玩家发现 / 是否接收邀请。 */
export interface PresencePreferences {
  discoverable: boolean
  acceptsInvites: boolean
}

/** 大厅「在线玩家」列表中展示的公开玩家信息（不含任何房间秘密）。 */
export interface PublicPlayer {
  id: string
  nickname: string
  avatarColor: string
  status: PresenceStatus
  roomId?: string
}

/** 房间成员视图：在公开玩家信息基础上叠加本局内的成员状态。 */
export interface RoomMember extends PublicPlayer {
  ready: boolean // 是否已准备（观战者恒为 false）
  score: number // 本局累计得分
  isHost: boolean // 是否为房主
  isDrawer: boolean // 是否当前画家
  guessed: boolean // 本回合是否已猜中
  spectating: boolean // 是否为观战成员（不参与准备/作画/猜词/计分）
  connection: ConnectionState // 连接状态
  /** 服务端累计的公开局内统计，仅包含计数和时长，不暴露猜词正文。 */
  stats: {
    correctCount: number // 猜中次数
    totalGuessMs: number // 猜中累计用时（毫秒）
    drawingCorrectCount: number // 作画时带动的猜中人次
  }
}

/** 房间规则；全部字段由服务端校验，客户端只能按配置允许的范围修改。 */
export interface RoomSettings {
  maxPlayers: number // 最大玩家数
  roundsPerPlayer: number // 每人作画轮数
  drawSeconds: number // 每回合作画秒数
  chooseSeconds: number // 选词阶段秒数
  optionCount: number // 每回合候选词个数
  showWordLength: boolean // 是否显示答案字数遮罩
  progressiveHints: boolean // 是否开启逐步提示（随时间揭示字符）
  closeGuessEnabled: boolean // 是否开启「很接近」提示
  allowPlayerInvite: boolean // 普通玩家是否可邀请
  allowPause: boolean // 是否允许暂停
  joinPolicy: 'forbid' | 'spectate' | 'next_game' // 对局中加入策略（首版固定为下一局）
}

/** 大厅房间列表行展示的公开房间摘要（无密码、无房间码）。 */
export interface PublicRoom {
  id: string
  name: string
  hostName: string
  playerCount: number
  maxPlayers: number
  phase: RoomPhase
  roundsPerPlayer: number
  drawSeconds: number
  joinPolicy: RoomSettings['joinPolicy'] // 中途加入策略（大厅据此决定是否可发起观战加入）
}

/** 聊天消息：猜词、系统、猜中、预设短语与「很接近」提示共用此结构。 */
export interface ChatMessage {
  id: string
  type: 'guess' | 'system' | 'correct' | 'preset' | 'close'
  text: string
  playerId?: string // 仅玩家消息有来源
  createdAt: number
}

/** 画布上的归一化坐标点；x/y 均在 0～1 之间，缩放不漂移。 */
export interface DrawPoint {
  x: number
  y: number
}

/** 自由笔画命令；橡皮擦也是自由笔画，只改变合成模式（destination-out）。 */
export interface Stroke {
  kind: 'stroke'
  id: string
  tool: 'pen' | 'eraser'
  color: string
  width: number
  points: DrawPoint[]
  sequence: number
}

/** 封闭区域填充命令；点击位置使用归一化坐标，实际像素区域由各客户端重放历史后计算。 */
export interface FillCommand {
  kind: 'fill'
  id: string
  point: DrawPoint
  color: string
  sequence: number
}

/** 画布历史使用可判别联合，服务端可对笔画与填充命令执行严格校验。 */
export type DrawingCommand = Stroke | FillCommand

/** 单个玩家的回合得分明细：基础分 + 速度奖励 + 顺序奖励 = 总分。 */
export interface ScoreDetail {
  playerId: string
  base: number // 猜中基础分
  speed: number // 速度奖励（按剩余时间比例线性衰减）
  order: number // 猜中顺序奖励（前几名有额外加分）
  total: number // 三者之和
}

/** 单回合结算数据：只有结算阶段才随快照下发答案正文。 */
export interface RoundResult {
  answer: string // 本回合答案
  details: ScoreDetail[] // 猜中者得分明细
  drawerScore: number // 画家本回合得分
}

/** 对局视图：按观看者角色裁剪后的当前对局状态（快照的 game 字段）。 */
export interface GameView {
  gameId: string
  roundId: string // 回合唯一 ID，绘图与猜词请求必须携带
  phaseBeforePause?: RoomPhase // 暂停前的阶段，用于恢复
  currentRound: number
  totalRounds: number
  drawerId: string // 当前画家
  phaseStartedAt: number
  phaseEndsAt: number // 服务端权威的截止时间戳（毫秒）
  answerMask: string // 猜词者可见的答案遮罩（画家可见真实答案）
  answer?: string // 仅当前画家可见
  wordOptions?: Array<{ id: string; text: string }> // 仅画家选词阶段可见
  strokes: DrawingCommand[] // 全部画布命令历史
  /** 是否省略 strokes（画布历史）：仅在该成员已在线同步全部增量时置位，客户端应沿用本地已有历史。 */
  strokesOmitted?: boolean
  undoneStrokeIds: string[] // 已撤销的命令 ID（用于重放过滤）
  lastSequence: number // 服务端已接受的绘图序号（供重连客户端续起 seq，避免被当旧包拒绝）
  messages: ChatMessage[] // 最近消息（服务端裁剪数量）
  roundResult?: RoundResult // 回合结算数据
}

/** 房间完整快照：大厅行摘要 + 成员 + 规则 + 角色裁剪的对局视图。 */
export interface RoomSnapshot {
  id: string
  name: string
  hostId: string
  phase: RoomPhase
  stateVersion: number // 状态版本号，用于乐观并发控制
  settings: RoomSettings
  members: RoomMember[]
  selectedWordCount: number // 本局已选词条数
  totalWordCount: number // 词库总词条数
  game?: GameView // 对局中才有
}

/** 词库词条：稳定 ID + 原始词面。 */
export interface VocabularyItem {
  id: string
  text: string
}

/** 词库快照：仅房主可见全部词条与当前选择。 */
export interface VocabularySnapshot {
  items: VocabularyItem[]
  selectedIds: string[]
  version: string // 词库内容哈希版本
}

/** 定向房间邀请：过期后将自动失效。 */
export interface Invite {
  id: string
  roomId: string
  roomName: string
  from: PublicPlayer
  expiresAt: number
}

/** 大厅在线状态快照：可发现玩家 + 全部公开房间。 */
export interface PresenceSnapshot {
  players: PublicPlayer[]
  rooms: PublicRoom[]
}

/**
 * 统一 ack 结构：所有可失败请求都返回此类型。
 * 成功时携带数据；失败时不泄露内部堆栈，只给错误码与可读消息。
 */
export type Ack<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string }; requestId: string }

/** 客户端请求统一带 requestId，以便服务端对重试请求执行幂等返回。 */
export const RequestSchema = z.object({ requestId: z.string().min(6).max(64) })
/** 玩家资料 schema：昵称长度按可见字符计，头像必须是 #RRGGBB 六位 HEX。 */
export const ProfileSchema = z.object({
  nickname: z
    .string()
    .trim()
    .min(APP_CONFIG.player.nicknameMinLength)
    .max(APP_CONFIG.player.nicknameMaxLength),
  avatarColor: z.string().regex(new RegExp(APP_CONFIG.player.colorPattern)),
})
/** 会话注册 schema：包含协议版本、资料、可选恢复令牌与发现偏好。 */
export const RegisterSchema = RequestSchema.extend({
  protocolVersion: z.string(),
  profile: ProfileSchema,
  recoveryToken: z.string().max(128).optional(), // 断线/刷新恢复令牌
  preferences: z.object({ discoverable: z.boolean(), acceptsInvites: z.boolean() }),
})
/** 房间规则 schema：数值字段全部按 config.ts 允许范围做整数校验。 */
export const RoomSettingsSchema = z.object({
  maxPlayers: z.number().int().min(APP_CONFIG.player.minPlayers).max(APP_CONFIG.player.maxPlayers),
  roundsPerPlayer: z
    .number()
    .int()
    .min(APP_CONFIG.game.roundsPerPlayer.min)
    .max(APP_CONFIG.game.roundsPerPlayer.max),
  drawSeconds: z
    .number()
    .int()
    .min(APP_CONFIG.game.drawSeconds.min)
    .max(APP_CONFIG.game.drawSeconds.max),
  chooseSeconds: z
    .number()
    .int()
    .min(APP_CONFIG.game.chooseSeconds.min)
    .max(APP_CONFIG.game.chooseSeconds.max),
  optionCount: z
    .number()
    .int()
    .min(APP_CONFIG.game.optionCount.min)
    .max(APP_CONFIG.game.optionCount.max),
  showWordLength: z.boolean(),
  progressiveHints: z.boolean(),
  closeGuessEnabled: z.boolean(),
  allowPlayerInvite: z.boolean(),
  allowPause: z.boolean(),
  joinPolicy: z.enum(['forbid', 'spectate', 'next_game']),
})
/** 创建房间 schema：房间名去空白后 1～24 字符，规则必须完整合法。 */
export const CreateRoomSchema = RequestSchema.extend({
  name: z.string().trim().min(1).max(APP_CONFIG.player.roomNameMaxLength),
  settings: RoomSettingsSchema,
})
/** 加入房间 schema：roomId 必须是合法 UUID。 */
export const JoinRoomSchema = RequestSchema.extend({ roomId: z.string().uuid() })
/** 画布点坐标 schema：x/y 必须在 0～1 之间（归一化）。 */
const DrawPointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
/** 画笔与填充共用的样式约束：颜色、线宽（带步进倍数）与单调递增序号。 */
const DrawStyleSchema = {
  color: z.string().regex(new RegExp(APP_CONFIG.drawing.colorPattern)),
  width: z
    .number()
    .min(APP_CONFIG.drawing.width.min)
    .max(APP_CONFIG.drawing.width.max)
    .multipleOf(APP_CONFIG.drawing.width.step),
  sequence: z.number().int().nonnegative(),
}
/** 自由笔画批次的 schema：同一笔画 ID 可分批追加点列。 */
export const StrokeSchema = z.object({
  kind: z.literal('stroke'),
  id: z.string().min(4).max(64),
  tool: z.enum(['pen', 'eraser']),
  ...DrawStyleSchema,
  points: z.array(DrawPointSchema).min(1).max(APP_CONFIG.drawing.maxPointsPerBatch),
})
/** 区域填充命令 schema：只有点击坐标与颜色，不携带任何像素数据。 */
export const FillCommandSchema = z.object({
  kind: z.literal('fill'),
  id: z.string().min(4).max(64),
  point: DrawPointSchema,
  color: z.string().regex(new RegExp(APP_CONFIG.drawing.colorPattern)),
  sequence: z.number().int().nonnegative(),
})

/** 将任意合法 HEX 颜色规范化为大写，确保客户端与服务端比较结果一致。 */
export function normalizeHexColor(value: string): string | undefined {
  return new RegExp(APP_CONFIG.drawing.colorPattern).test(value) ? value.toUpperCase() : undefined
}

/** 标准化猜词；Unicode NFKC 可合并全角拉丁字符，中文词面不会被破坏。 */
export function normalizeAnswer(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

/** 按 Unicode 码点生成遮罩，标点和空白保留，避免中文代理对被拆开。 */
export function createAnswerMask(
  answer: string,
  revealed: ReadonlySet<number> = new Set(),
): string {
  return Array.from(answer)
    .map((character, index) =>
      /^[\p{P}\p{Z}\s]$/u.test(character) || revealed.has(index) ? character : '＿',
    )
    .join('')
}

/**
 * 计算猜中者分数。速度奖励按剩余时间比例线性衰减，并通过取整保证各客户端展示一致。
 * 两人局不使用顺序奖，避免唯一猜词者天然获得第一名额外分。
 */
export function calculateGuessScore(input: {
  elapsedMs: number
  durationMs: number
  correctOrder: number
  playerCount: number
  base: number
  maxSpeedBonus: number
  orderBonuses: readonly number[]
}): Omit<ScoreDetail, 'playerId'> {
  const duration = Math.max(1, input.durationMs)
  const remainingRatio = Math.max(0, Math.min(1, 1 - input.elapsedMs / duration))
  const speed = Math.round(input.maxSpeedBonus * remainingRatio)
  const order = input.playerCount === 2 ? 0 : (input.orderBonuses[input.correctOrder - 1] ?? 0)
  return { base: input.base, speed, order, total: input.base + speed + order }
}

/** 轻量编辑距离仅用于“很接近”私有提示，不会返回差异位置。 */
export function isCloseAnswer(guess: string, answer: string): boolean {
  const left = Array.from(normalizeAnswer(guess))
  const right = Array.from(normalizeAnswer(answer))
  if (!left.length || Math.abs(left.length - right.length) > 1) return false
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index)
  for (let y = 1; y <= right.length; y += 1) {
    let previous = rows[0] ?? 0
    rows[0] = y
    for (let x = 1; x <= left.length; x += 1) {
      const before = rows[x] ?? x
      rows[x] = Math.min(
        (rows[x] ?? 0) + 1,
        (rows[x - 1] ?? 0) + 1,
        previous + (left[x - 1] === right[y - 1] ? 0 : 1),
      )
      previous = before
    }
  }
  return (rows[left.length] ?? 2) === 1
}

/**
 * 房间阶段合法转换表：每个阶段列出的目标阶段都是显式允许的。
 * 任何未列出的转换都会被服务端拒绝并返回 INVALID_TRANSITION。
 */
const LEGAL_PHASES: Record<RoomPhase, readonly RoomPhase[]> = {
  waiting: ['starting', 'closed'],
  starting: ['waiting', 'choosing_word', 'closed'],
  // choosing_word → round_result 表示“画家弃权，本回合作废”后进入（由 abandonChoosing 使用）
  choosing_word: ['drawing', 'paused', 'closed', 'game_result', 'round_result'],
  drawing: ['round_result', 'paused', 'closed', 'game_result'],
  round_result: ['choosing_word', 'game_result', 'paused', 'closed'],
  paused: ['choosing_word', 'drawing', 'round_result', 'game_result', 'closed'],
  game_result: ['waiting', 'closed'],
  closed: [],
}

/** 状态转换显式白名单；非法转换必须由调用方拒绝并记录。 */
export function canTransition(from: RoomPhase, to: RoomPhase): boolean {
  return LEGAL_PHASES[from].includes(to)
}
