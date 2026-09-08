import { z } from 'zod'
import { RequestSchema, WordIdSchema } from './base.ts'
import { MAX_VOCABULARY_SELECTION_IDS } from './constants.ts'

export const UpdateVocabularySchema = RequestSchema.extend({
  ids: z.array(WordIdSchema).max(MAX_VOCABULARY_SELECTION_IDS),
  expectedVersion: z.number().int().nonnegative(),
})
export const SelectVocabularyPackageSchema = RequestSchema.extend({
  packageId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative().optional(),
})
