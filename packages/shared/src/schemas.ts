/**
 * 客户端请求与载荷的运行时校验（Zod schema），与 types.ts 的类型一一对应。
 * 校验范围直接取自根级 config.ts，服务端对每个事件执行严格 parse。
 */
import { z } from 'zod'
import { APP_CONFIG } from '../../../config/index.ts'

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
const AvatarIdSchema = z.enum(APP_CONFIG.player.avatarIds)
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
/** 房间规则 schema：数值字段全部按 config.ts 允许范围做整数校验。 */
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
