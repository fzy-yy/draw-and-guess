/**
 * 客户端请求与载荷的运行时校验（Zod schema），与 types.ts 的类型一一对应。
 * 校验范围直接取自根级 config.ts，服务端对每个事件执行严格 parse。
 */
import { z } from 'zod'
import { APP_CONFIG } from '../../../config.ts'

/** 客户端请求统一带 UUID requestId，以便服务端对重试请求执行幂等返回。 */
export const RequestSchema = z.object({ requestId: z.string().uuid() }).strict()
/** 内置 SVG 头像编号白名单；拒绝任意 URL、文件路径和 SVG 正文。 */
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
/** 会话注册 schema：只允许使用不公开的恢复令牌接管既有身份，公开玩家 ID 不能用于登录。 */
export const RegisterSchema = RequestSchema.extend({
  protocolVersion: z.string().min(1).max(16),
  profile: ProfileSchema,
  // 断线/刷新恢复令牌：仅当服务端仍保留该身份（宽限期内）才有效
  recoveryToken: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,128}$/u)
    .optional(),
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
    closeGuessEnabled: z.boolean(),
    allowPlayerInvite: z.boolean(),
    allowPause: z.boolean(),
    joinPolicy: z.enum(['forbid', 'spectate', 'next_game']),
  })
  .strict()
/** 房间可见性与私密房间码 schema 均由共享协议统一定义。 */
export const RoomVisibilitySchema = z.enum(['public', 'private'])
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
