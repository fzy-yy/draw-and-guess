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
export const PauseGameSchema = RequestSchema.extend({ reason: z.string().max(40) })
