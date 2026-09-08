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
export const PauseGameSchema = RequestSchema.extend({ reason: z.string().max(40) })
