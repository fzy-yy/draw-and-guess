/**
 * 前后端共享协议、运行时校验与无环境依赖领域纯函数。
 * 此模块只描述可公开的数据结构，绝不声明服务端秘密答案容器或密码字段。
 */
import { z } from 'zod'
import { APP_CONFIG } from '../../../config.ts'

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

export type RoomPhase =
  | 'waiting'
  | 'starting'
  | 'choosing_word'
  | 'drawing'
  | 'round_result'
  | 'paused'
  | 'game_result'
  | 'closed'

export type ConnectionState = 'online' | 'reconnecting'
export type PresenceStatus = 'idle' | 'in_room' | 'playing' | 'reconnecting'
export type ToolKind = 'pen' | 'eraser' | 'fill'

export interface Profile {
  nickname: string
  avatarColor: string
}

export interface PresencePreferences {
  discoverable: boolean
  acceptsInvites: boolean
}

export interface PublicPlayer {
  id: string
  nickname: string
  avatarColor: string
  status: PresenceStatus
  roomId?: string
}

export interface RoomMember extends PublicPlayer {
  ready: boolean
  score: number
  isHost: boolean
  isDrawer: boolean
  guessed: boolean
  connection: ConnectionState
  /** 服务端累计的公开局内统计，仅包含计数和时长，不暴露猜词正文。 */
  stats: {
    correctCount: number
    totalGuessMs: number
    drawingCorrectCount: number
  }
}

export interface RoomSettings {
  maxPlayers: number
  roundsPerPlayer: number
  drawSeconds: number
  chooseSeconds: number
  optionCount: number
  showWordLength: boolean
  progressiveHints: boolean
  closeGuessEnabled: boolean
  allowPlayerInvite: boolean
  allowPause: boolean
  joinPolicy: 'forbid' | 'spectate' | 'next_game'
}

export interface PublicRoom {
  id: string
  name: string
  hostName: string
  playerCount: number
  maxPlayers: number
  phase: RoomPhase
  roundsPerPlayer: number
  drawSeconds: number
}

export interface ChatMessage {
  id: string
  type: 'guess' | 'system' | 'correct' | 'preset' | 'close'
  text: string
  playerId?: string
  createdAt: number
}

export interface DrawPoint {
  x: number
  y: number
}

/** 自由笔画命令；橡皮擦也是自由笔画，只改变合成模式。 */
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

export interface ScoreDetail {
  playerId: string
  base: number
  speed: number
  order: number
  total: number
}

export interface RoundResult {
  answer: string
  details: ScoreDetail[]
  drawerScore: number
}

export interface GameView {
  gameId: string
  roundId: string
  phaseBeforePause?: RoomPhase
  currentRound: number
  totalRounds: number
  drawerId: string
  phaseStartedAt: number
  phaseEndsAt: number
  answerMask: string
  answer?: string
  wordOptions?: Array<{ id: string; text: string }>
  strokes: DrawingCommand[]
  undoneStrokeIds: string[]
  messages: ChatMessage[]
  roundResult?: RoundResult
}

export interface RoomSnapshot {
  id: string
  name: string
  hostId: string
  phase: RoomPhase
  stateVersion: number
  settings: RoomSettings
  members: RoomMember[]
  selectedWordCount: number
  totalWordCount: number
  game?: GameView
}

export interface VocabularyItem {
  id: string
  text: string
}

export interface VocabularySnapshot {
  items: VocabularyItem[]
  selectedIds: string[]
  version: string
}

export interface Invite {
  id: string
  roomId: string
  roomName: string
  from: PublicPlayer
  expiresAt: number
}

export interface PresenceSnapshot {
  players: PublicPlayer[]
  rooms: PublicRoom[]
}

export type Ack<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string }; requestId: string }

/** 客户端请求统一带 requestId，以便服务端对重试请求执行幂等返回。 */
export const RequestSchema = z.object({ requestId: z.string().min(6).max(64) })
export const ProfileSchema = z.object({
  nickname: z
    .string()
    .trim()
    .min(APP_CONFIG.player.nicknameMinLength)
    .max(APP_CONFIG.player.nicknameMaxLength),
  avatarColor: z.string().regex(new RegExp(APP_CONFIG.player.colorPattern)),
})
export const RegisterSchema = RequestSchema.extend({
  protocolVersion: z.string(),
  profile: ProfileSchema,
  recoveryToken: z.string().max(128).optional(),
  preferences: z.object({ discoverable: z.boolean(), acceptsInvites: z.boolean() }),
})
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
export const CreateRoomSchema = RequestSchema.extend({
  name: z.string().trim().min(1).max(APP_CONFIG.player.roomNameMaxLength),
  settings: RoomSettingsSchema,
})
export const JoinRoomSchema = RequestSchema.extend({ roomId: z.string().uuid() })
const DrawPointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
const DrawStyleSchema = {
  color: z.string().regex(new RegExp(APP_CONFIG.drawing.colorPattern)),
  width: z
    .number()
    .min(APP_CONFIG.drawing.width.min)
    .max(APP_CONFIG.drawing.width.max)
    .multipleOf(APP_CONFIG.drawing.width.step),
  sequence: z.number().int().nonnegative(),
}
export const StrokeSchema = z.object({
  kind: z.literal('stroke'),
  id: z.string().min(4).max(64),
  tool: z.enum(['pen', 'eraser']),
  ...DrawStyleSchema,
  points: z.array(DrawPointSchema).min(1).max(APP_CONFIG.drawing.maxPointsPerBatch),
})
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

const LEGAL_PHASES: Record<RoomPhase, readonly RoomPhase[]> = {
  waiting: ['starting', 'closed'],
  starting: ['waiting', 'choosing_word', 'closed'],
  choosing_word: ['drawing', 'paused', 'closed', 'game_result'],
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
