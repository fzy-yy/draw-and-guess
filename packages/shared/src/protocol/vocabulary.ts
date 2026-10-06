import { z } from 'zod'
import { RequestSchema, WordIdSchema } from './base.ts'
import { MAX_VOCABULARY_SELECTION_IDS } from './constants.ts'

export const UpdateVocabularySchema = RequestSchema.extend({
  ids: z.array(WordIdSchema).max(MAX_VOCABULARY_SELECTION_IDS),
  expectedVersion: z.number().int().nonnegative(),
})
export const SelectVocabularyPackagesSchema = RequestSchema.extend({
  packageIds: z.array(z.string().min(1)).min(1),
  expectedVersion: z.number().int().nonnegative().optional(),
})
/** 向后兼容导出 */
export const SelectVocabularyPackageSchema = SelectVocabularyPackagesSchema
