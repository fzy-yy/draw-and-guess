import type { z } from 'zod'
import type {
  VocabularyPackageInfoSchema,
  VocabularySnapshotSchema,
  VocabularyWordSchema,
} from '../protocol/response.ts'

export const MIN_SELECTED_VOCABULARY_WORDS = 60

/** 词条、词库包与房间词库快照均由响应 Schema 推导，保证与服务端线格式一致。 */
export type VocabularyWord = z.infer<typeof VocabularyWordSchema>
export type VocabularyPackageInfo = z.infer<typeof VocabularyPackageInfoSchema>
export type VocabularySnapshot = z.infer<typeof VocabularySnapshotSchema>
