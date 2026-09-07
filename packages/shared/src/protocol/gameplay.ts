import { z } from 'zod'
import { APP_CONFIG } from '../../../../config/index.ts'
import { RequestSchema, WordIdSchema } from './base.ts'

export const GuessWordSchema = RequestSchema.extend({
  roundId: z.string().uuid(),
  text: z.string().min(1).max(APP_CONFIG.player.chatMaxLength),
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
