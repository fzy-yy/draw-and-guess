import type { z } from 'zod'
import type {
  RelayCanvasSchema,
  RelayGameViewSchema,
  RelayPlayerRefSchema,
  RelayShowcaseCapsuleSchema,
  RelayShowcaseSchema,
  RelayVoteChoiceSchema,
} from '../protocol/push.ts'
import type {
  RelayHalfSchema,
  RelayPhaseSchema,
  RelayStepIdSchema,
  RelayStepSchema,
} from '../protocol/relay.ts'

/**
 * 接龙公开 DTO：全部由 `protocol/` 的运行时 Schema 推导（手写接口会与线格式漂移）。
 * 这些类型是共享协议的一部分——服务端视图构建器与客户端接龙 Store 都从这里取。
 */
export type RelayPhase = z.infer<typeof RelayPhaseSchema>
export type RelayStep = z.infer<typeof RelayStepSchema>
export type RelayStepId = z.infer<typeof RelayStepIdSchema>
export type RelayHalf = z.infer<typeof RelayHalfSchema>
export type RelayPlayerRef = z.infer<typeof RelayPlayerRefSchema>
export type RelayCanvas = z.infer<typeof RelayCanvasSchema>
export type RelayVoteChoice = z.infer<typeof RelayVoteChoiceSchema>
export type RelayShowcaseCapsule = z.infer<typeof RelayShowcaseCapsuleSchema>
export type RelayShowcase = z.infer<typeof RelayShowcaseSchema>
export type RelayGameView = z.infer<typeof RelayGameViewSchema>
