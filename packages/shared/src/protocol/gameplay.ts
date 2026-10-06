import { z } from 'zod'
import { RequestSchema, WordIdSchema } from './base.ts'
import { PLAYER_PROTOCOL_LIMITS } from './constants.ts'

export const GuessWordSchema = RequestSchema.extend({
  roundId: z.string().uuid(),
  text: z.string().min(1).max(PLAYER_PROTOCOL_LIMITS.chatMaxLength),
})
export const SendPresetSchema = RequestSchema.extend({
  roundId: z.string().uuid(),
  preset: z.string(),
})
export const StartGameSchema = RequestSchema.extend({
  expectedVersion: z.number().int().nonnegative(),
})
export const ChooseWordSchema = RequestSchema.extend({
  roundId: z.string().uuid(),
  wordId: WordIdSchema,
})
export const RerollWordsSchema = RequestSchema.extend({ roundId: z.string().uuid() })
/**
 * 画家自定义词：payload 只带词面文本，长度上下限放宽到协议级（1~64 个 UTF-16 单元），
 * grapheme 上限、字符集与撞词判定由服务端领域规则裁决并给出具体错误码。
 */
export const CustomWordSchema = RequestSchema.extend({
  roundId: z.string().uuid(),
  text: z.string().min(1).max(64),
})

/** 画布微表情反应类型枚举（点赞、困惑/问号、火焰/神仙画画）。 */
export const CANVAS_PING_TYPES = ['thumbs_up', 'confused', 'fire'] as const
export const CanvasPingTypeSchema = z.enum(CANVAS_PING_TYPES)
export type CanvasPingType = z.infer<typeof CanvasPingTypeSchema>

/** 客户端请求发送画布微表情的载荷 Schema。 */
export const CanvasPingPayloadSchema = RequestSchema.extend({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  type: CanvasPingTypeSchema,
})
export type CanvasPingPayload = z.infer<typeof CanvasPingPayloadSchema>

/** 服务端广播全员可见的微表情数据 Schema。 */
export const CanvasPingBroadcastSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    type: CanvasPingTypeSchema,
    senderNickname: z.string(),
  })
  .strict()
export type CanvasPingBroadcast = z.infer<typeof CanvasPingBroadcastSchema>
