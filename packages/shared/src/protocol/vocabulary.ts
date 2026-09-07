import { z } from 'zod'
import { RequestSchema, WordIdSchema } from './base.ts'

export const UpdateVocabularySchema = RequestSchema.extend({
  ids: z.array(WordIdSchema),
  expectedVersion: z.number().int().nonnegative(),
})
export const SelectVocabularyPackageSchema = RequestSchema.extend({
  packageId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative().optional(),
})
