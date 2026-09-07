import type { AvatarId, RoomPhase } from './common.ts'
import type { DrawingCommand } from './drawing.ts'

export interface ChatMessage {
  id: string
  type: 'guess' | 'system' | 'correct' | 'preset'
  text: string
  playerId?: string
  createdAt: number
}
export interface ScoreDetail {
  playerId: string
  base: number
  speed: number
  order: number
  total: number
}
export interface RoundResult {
  answer: string
  details: ScoreDetail[]
  drawerScore: number
}
export interface FinalRankingEntry {
  id: string
  nickname: string
  avatarId: AvatarId
  rank: number
  score: number
  stats: { correctCount: number; totalGuessMs: number; drawingCorrectCount: number }
}
export interface GameView {
  gameId: string
  roundId: string
  phaseBeforePause?: RoomPhase
  currentRound: number
  totalRounds: number
  drawerId: string
  phaseStartedAt: number
  phaseEndsAt: number
  pausedRemainingMs?: number
  answerMask: string
  answer?: string
  wordCategory?: string
  wordOptions?: Array<{ id: string; text: string; difficulty: number }>
  canReroll?: boolean
  revealedHints?: string[]
  strokes: DrawingCommand[]
  strokesOmitted?: boolean
  undoneStrokeIds: string[]
  lastSequence: number
  drawingRevision: number
  messages: ChatMessage[]
  roundResult?: RoundResult
  finalRanking?: FinalRankingEntry[]
}
