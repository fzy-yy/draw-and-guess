import type { z } from 'zod'
import type {
  RelayCanvasSchema,
  RelayFinalRankingEntrySchema,
  RelayGameViewSchema,
  RelayPlayerRefSchema,
  RelayShowcaseSchema,
  RelayViewPhaseSchema,
} from '../protocol/push.ts'
import type {
  RelayHalfSchema,
  RelayPhaseSchema,
  RelayStepIdSchema,
  RelayStepSchema,
  RelayVoteChoiceSchema,
} from '../protocol/relay.ts'

/**
 * 接龙公开 DTO：全部由 `protocol/` 的运行时 Schema 推导（手写接口会与线格式漂移）。
 * 这些类型是共享协议的一部分——服务端视图构建器与客户端接龙 Store 都从这里取。
 */
export type RelayPhase = z.infer<typeof RelayPhaseSchema>
/** 接龙视图所处的阶段：五个接龙阶段 + 终局（`game_result` 只在视图里放宽）。 */
export type RelayViewPhase = z.infer<typeof RelayViewPhaseSchema>
export type RelayStep = z.infer<typeof RelayStepSchema>
export type RelayStepId = z.infer<typeof RelayStepIdSchema>
export type RelayHalf = z.infer<typeof RelayHalfSchema>
export type RelayPlayerRef = z.infer<typeof RelayPlayerRefSchema>
export type RelayCanvas = z.infer<typeof RelayCanvasSchema>
export type RelayVoteChoice = z.infer<typeof RelayVoteChoiceSchema>
export type RelayShowcase = z.infer<typeof RelayShowcaseSchema>
/** 终局榜的一行：只有名次、分数与接龙口径统计（无称号、无链明细，S33）。 */
export type RelayFinalRankingEntry = z.infer<typeof RelayFinalRankingEntrySchema>
export type RelayGameView = z.infer<typeof RelayGameViewSchema>
