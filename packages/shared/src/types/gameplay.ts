import type { z } from 'zod'
import type {
  ChatMessageSchema,
  FinalRankingEntrySchema,
  GameViewSchema,
  RoundResultSchema,
  ScoreDetailSchema,
} from '../protocol/push.ts'

export type ChatMessage = z.infer<typeof ChatMessageSchema>
export type ScoreDetail = z.infer<typeof ScoreDetailSchema>
export type RoundResult = z.infer<typeof RoundResultSchema>
export type FinalRankingEntry = z.infer<typeof FinalRankingEntrySchema>
export type GameView = z.infer<typeof GameViewSchema>
