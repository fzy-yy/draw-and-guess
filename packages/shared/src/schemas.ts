/**
 * 客户端请求与载荷的运行时校验（Zod schema），与 types.ts 的类型一一对应。
 * 校验范围直接取自 config/index.ts 聚合配置，服务端对每个事件执行严格 parse。
 */
import { z } from 'zod'
import { APP_CONFIG } from '../../../config/index.ts'
import { EVENTS } from './events.ts'

/** 客户端请求统一带 UUID requestId，以便服务端对重试请求执行幂等返回。 */
export const RequestSchema = z.object({ requestId: z.string().uuid() }).strict()
/**
 * 词库词条 ID 校验：格式与词库来源解耦（SQLite 实现为「sqlite:正整数主键」字符串化，
 * 将来其它来源可以是任意可打印主键串），仅限定可见 ASCII 字符集与长度。
 */
export const WordIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9:_-]+$/u, { message: 'invalid word id' })
/** 内置 SVG 头像编号白名单；拒绝任意 URL、文件路径和 SVG 正文（仅供 ProfileSchema 内部复用）。 */
export const AvatarIdSchema = z.enum(APP_CONFIG.player.avatarIds)
/** 玩家资料 schema：昵称由服务层按 Unicode 码点复核，头像必须来自内置白名单。 */
export const ProfileSchema = z
  .object({
    nickname: z
      .string()
      .trim()
      .min(1)
      .max(APP_CONFIG.player.nicknameMaxLength * 2),
    avatarId: AvatarIdSchema,
  })
  .strict()
/** 服务端签发的秘密恢复令牌格式；客户端加载本地资料时复用校验，避免损坏存储阻塞自动恢复。 */
export const RecoveryTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u)
/** 会话注册 schema：只允许使用不公开的恢复令牌接管既有身份，公开玩家 ID 不能用于登录。 */
export const RegisterSchema = RequestSchema.extend({
  protocolVersion: z.string().min(1).max(16),
  profile: ProfileSchema,
  // 断线/刷新恢复令牌：仅当服务端仍保留该身份（宽限期内）才有效
  recoveryToken: RecoveryTokenSchema.optional(),
  preferences: z.object({ discoverable: z.boolean(), acceptsInvites: z.boolean() }).strict(),
})
/** 房间规则 schema：数值字段全部按 config/ 允许范围做整数校验。 */
export const RoomSettingsSchema = z
  .object({
    maxPlayers: z
      .number()
      .int()
      .min(APP_CONFIG.player.minPlayers)
      .max(APP_CONFIG.player.maxPlayers),
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
    structuredHintsEnabled: z.boolean(),
    // 区间一律读自配置单一来源（config/game.ts 的 hintStartRatioRange / guessBaseRange），
    // 禁止在协议层另写一套允许范围。
    hintStartRatio: z
      .number()
      .min(APP_CONFIG.game.hintStartRatioRange.min)
      .max(APP_CONFIG.game.hintStartRatioRange.max),
    guessBaseScore: z
      .number()
      .int()
      .min(APP_CONFIG.game.score.guessBaseRange.min)
      .max(APP_CONFIG.game.score.guessBaseRange.max),
    scoreMode: z.enum(['standard', 'flat']),
    allowPlayerInvite: z.boolean(),
    allowPause: z.boolean(),
    allowWordReroll: z.boolean(),
    joinPolicy: z.enum(['forbid', 'spectate', 'next_game']),
  })
  .strict()
/** 房间可见性与私密房间码 schema 均由共享协议统一定义。 */
const RoomVisibilitySchema = z.enum(['public', 'private'])
export const PrivateRoomCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/gu, '').toUpperCase())
  .refine(
    (value) =>
      value.length === APP_CONFIG.room.privateCodeLength &&
      [...value].every((character) => APP_CONFIG.room.privateCodeAlphabet.includes(character)),
    { message: 'invalid private room code' },
  )
/** 创建房间 schema：房间名、可见性和完整规则都必须合法。 */
export const CreateRoomSchema = RequestSchema.extend({
  name: z.string().trim().min(1).max(APP_CONFIG.player.roomNameMaxLength),
  visibility: RoomVisibilitySchema,
  settings: RoomSettingsSchema,
})
/** 公开加入使用内部 UUID；私密加入只能使用服务端生成的房间码。 */
export const JoinRoomSchema = RequestSchema.extend({ roomId: z.string().uuid() })
export const JoinPrivateRoomSchema = RequestSchema.extend({ code: PrivateRoomCodeSchema })
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
  startPointIndex: z.number().int().nonnegative().optional(),
})
/** 区域填充命令 schema：只有点击坐标与颜色，不携带任何像素数据。 */
export const FillCommandSchema = z.object({
  kind: z.literal('fill'),
  id: z.string().min(4).max(64),
  point: DrawPointSchema,
  color: z.string().regex(new RegExp(APP_CONFIG.drawing.colorPattern)),
  sequence: z.number().int().nonnegative(),
})

// 注：HEX 颜色的规范化实现位于 `pure.ts` 的 `normalizeHexColor`，此处只保留结构校验。

/** 准备状态切换 schema */
export const SetReadySchema = RequestSchema.extend({
  ready: z.boolean(),
})

/** 修改房间规则 schema */
export const UpdateRoomSettingsSchema = RequestSchema.extend({
  patch: RoomSettingsSchema.partial(),
  expectedVersion: z.number().int().nonnegative(),
})

/** 修改词库配置 schema */
export const UpdateVocabularySchema = RequestSchema.extend({
  ids: z.array(WordIdSchema),
  expectedVersion: z.number().int().nonnegative(),
})

/** 房主选择词库包 schema */
export const SelectVocabularyPackageSchema = RequestSchema.extend({
  packageId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative().optional(),
})

/** 房主踢人与移交房主 schema */
export const KickMemberSchema = RequestSchema.extend({
  targetId: z.string().uuid(),
})
export const TransferHostSchema = RequestSchema.extend({
  targetId: z.string().uuid(),
})

/** 定向邀请发送与应答 schema */
export const SendInviteSchema = RequestSchema.extend({
  targetId: z.string().uuid(),
})
export const RespondInviteSchema = RequestSchema.extend({
  inviteId: z.string().uuid(),
  accept: z.boolean(),
})

/** 猜词与预设短语 schema */
export const GuessWordSchema = RequestSchema.extend({
  roundId: z.string().uuid(),
  text: z.string().min(1).max(APP_CONFIG.player.chatMaxLength),
})
export const SendPresetSchema = RequestSchema.extend({
  roundId: z.string().uuid(),
  preset: z.string(),
})

/** 对局控制相关 schema */
export const StartGameSchema = RequestSchema.extend({
  expectedVersion: z.number().int().nonnegative(),
})
export const ChooseWordSchema = RequestSchema.extend({
  roundId: z.string().uuid(),
  wordId: WordIdSchema,
})
export const RerollWordsSchema = RequestSchema.extend({
  roundId: z.string().uuid(),
})
export const PauseGameSchema = RequestSchema.extend({
  reason: z.string().max(40),
})
export const LogoutSchema = RequestSchema
export const StateResyncSchema = RequestSchema.extend({
  roomId: z.string().uuid().optional(),
  gameId: z.string().uuid().optional(),
  roundId: z.string().uuid().optional(),
})

// —— 服务端主动推送运行时解码 ——
// 全部对象使用 strict，防止服务端 Secret 字段因误展开而被客户端静默接收。
export const RoomPhaseSchema = z.enum([
  'waiting',
  'starting',
  'choosing_word',
  'drawing',
  'round_result',
  'paused',
  'game_result',
  'closed',
])
const ConnectionStateSchema = z.enum(['online', 'reconnecting', 'left'])
const PresenceStatusSchema = z.enum(['idle', 'in_room', 'playing', 'reconnecting'])
const PublicPlayerSchema = z
  .object({
    id: z.string().uuid(),
    nickname: z.string(),
    avatarId: AvatarIdSchema,
    status: PresenceStatusSchema,
    roomId: z.string().uuid().optional(),
  })
  .strict()
const PublicRoomSchema = z
  .object({
    visibility: z.literal('public'),
    id: z.string().uuid(),
    name: z.string(),
    hostName: z.string(),
    playerCount: z.number().int().nonnegative(),
    maxPlayers: z.number().int().positive(),
    phase: RoomPhaseSchema,
    roundsPerPlayer: z.number().int().positive(),
    drawSeconds: z.number().int().positive(),
    joinPolicy: z.enum(['forbid', 'spectate', 'next_game']),
  })
  .strict()
const MemberStatsSchema = z
  .object({
    correctCount: z.number().int().nonnegative(),
    totalGuessMs: z.number().nonnegative(),
    drawingCorrectCount: z.number().int().nonnegative(),
  })
  .strict()
const RoomMemberSchema = PublicPlayerSchema.extend({
  seatIndex: z.number().int().nonnegative(),
  seatColor: z.string(),
  ready: z.boolean(),
  score: z.number(),
  isHost: z.boolean(),
  isDrawer: z.boolean(),
  guessed: z.boolean(),
  spectating: z.boolean(),
  leftGame: z.boolean(),
  connection: ConnectionStateSchema,
  stats: MemberStatsSchema,
}).strict()
const ChatMessageSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(['guess', 'system', 'correct', 'preset']),
    text: z.string(),
    playerId: z.string().uuid().optional(),
    createdAt: z.number(),
  })
  .strict()
const ScoreDetailSchema = z
  .object({
    playerId: z.string().uuid(),
    base: z.number(),
    speed: z.number(),
    order: z.number(),
    total: z.number(),
  })
  .strict()
const RoundResultSchema = z
  .object({ answer: z.string(), details: z.array(ScoreDetailSchema), drawerScore: z.number() })
  .strict()
const FinalRankingEntrySchema = z
  .object({
    id: z.string().uuid(),
    nickname: z.string(),
    avatarId: AvatarIdSchema,
    rank: z.number().int().positive(),
    score: z.number(),
    stats: MemberStatsSchema,
  })
  .strict()
const DrawingCommandSchema = z.discriminatedUnion('kind', [
  StrokeSchema.strict(),
  FillCommandSchema.strict(),
])
const GameViewSchema = z
  .object({
    gameId: z.string().uuid(),
    roundId: z.union([z.string().uuid(), z.literal('')]),
    phaseBeforePause: RoomPhaseSchema.optional(),
    currentRound: z.number().int().nonnegative(),
    totalRounds: z.number().int().nonnegative(),
    drawerId: z.union([z.string().uuid(), z.literal('')]),
    phaseStartedAt: z.number(),
    phaseEndsAt: z.number(),
    pausedRemainingMs: z.number().nonnegative().optional(),
    answerMask: z.string(),
    answer: z.string().optional(),
    wordCategory: z.string().optional(),
    wordOptions: z
      .array(
        z.object({ id: WordIdSchema, text: z.string(), difficulty: z.number().int() }).strict(),
      )
      .optional(),
    canReroll: z.boolean().optional(),
    revealedHints: z.array(z.string()).optional(),
    strokes: z.array(DrawingCommandSchema),
    strokesOmitted: z.boolean().optional(),
    undoneStrokeIds: z.array(z.string()),
    lastSequence: z.number().int(),
    drawingRevision: z.number().int().nonnegative(),
    messages: z.array(ChatMessageSchema),
    roundResult: RoundResultSchema.optional(),
    finalRanking: z.array(FinalRankingEntrySchema).optional(),
  })
  .strict()

export const RoomSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    hostId: z.string().uuid(),
    visibility: z.enum(['public', 'private']),
    privateJoinCode: z.string().optional(),
    phase: RoomPhaseSchema,
    stateVersion: z.number().int().nonnegative(),
    settings: RoomSettingsSchema,
    members: z.array(RoomMemberSchema),
    selectedWordCount: z.number().int().nonnegative(),
    totalWordCount: z.number().int().nonnegative(),
    vocabularyPackageId: z.string().optional(),
    vocabularyPackageName: z.string().optional(),
    game: GameViewSchema.optional(),
  })
  .strict()

export const PresenceSnapshotSchema = z
  .object({ players: z.array(PublicPlayerSchema), rooms: z.array(PublicRoomSchema) })
  .strict()
export const InviteSchema = z
  .object({
    id: z.string().uuid(),
    roomId: z.string().uuid(),
    roomName: z.string(),
    from: PublicPlayerSchema,
    expiresAt: z.number(),
  })
  .strict()
export const MemberConnectionChangeSchema = z
  .object({ playerId: z.string().uuid(), nickname: z.string(), connection: ConnectionStateSchema })
  .strict()

function pushEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ protocolVersion: z.literal(APP_CONFIG.app.protocolVersion), data }).strict()
}

/** 服务端主动推送事件与完整解码器的唯一映射。 */
export const SERVER_PUSH_SCHEMAS = {
  [EVENTS.presenceSnapshot]: pushEnvelope(PresenceSnapshotSchema),
  [EVENTS.roomListChanged]: pushEnvelope(z.array(PublicRoomSchema)),
  [EVENTS.roomSnapshot]: pushEnvelope(RoomSnapshotSchema),
  [EVENTS.roomMemberConnectionChanged]: pushEnvelope(MemberConnectionChangeSchema),
  [EVENTS.inviteReceived]: pushEnvelope(InviteSchema),
  [EVENTS.inviteResolved]: pushEnvelope(
    z.object({ id: z.string().uuid(), status: z.string() }).strict(),
  ),
  [EVENTS.roomClosed]: pushEnvelope(z.object({ reason: z.string() }).strict()),
  [EVENTS.systemNotice]: pushEnvelope(z.object({ text: z.string() }).strict()),
  [EVENTS.systemError]: pushEnvelope(z.object({ text: z.string() }).strict()),
  [EVENTS.drawStrokeBatch]: pushEnvelope(
    z
      .object({
        roomId: z.string().uuid(),
        gameId: z.string().uuid(),
        roundId: z.string().uuid(),
        drawingRevision: z.number().int().positive(),
        stroke: StrokeSchema.strict(),
      })
      .strict(),
  ),
  [EVENTS.drawFillCommit]: pushEnvelope(
    z
      .object({
        roomId: z.string().uuid(),
        gameId: z.string().uuid(),
        roundId: z.string().uuid(),
        drawingRevision: z.number().int().positive(),
        fill: FillCommandSchema.strict(),
      })
      .strict(),
  ),
} as const

export type ServerPushEventName = keyof typeof SERVER_PUSH_SCHEMAS

/** 由服务端创建统一协议信封；主动推送不得绕过此入口。 */
export function createServerPush<T>(data: T): { protocolVersion: string; data: T } {
  return { protocolVersion: APP_CONFIG.app.protocolVersion, data }
}
