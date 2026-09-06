/** 回合提示调度的纯计算层：不创建定时器、不修改房间状态，便于独立测试。 */
export interface HintScheduleInput {
  totalMs: number
  currentRemainingMs: number
  progressiveHints: boolean
  wordText: string
  revealedCount: number
  structuredHintsEnabled: boolean
  hasStructuredHint: boolean
  revealedHintCount: number
  hintStartRatio: number
}

export interface HintSchedule {
  progressiveDelays: number[]
  structuredDelay?: number
}

export function createHintSchedule(input: HintScheduleInput): HintSchedule {
  const progressiveDelays: number[] = []
  if (input.progressiveHints) {
    const hintCount = Math.floor(Array.from(input.wordText).length / 2)
    if (hintCount > 0) {
      const totalSec = Math.floor(input.totalMs / 1_000)
      const windowSec = Math.floor(totalSec * APP_CONFIG.game.progressiveHintRatio)
      const intervalMs = Math.floor((windowSec / hintCount) * 1_000)
      for (let k = Math.max(1, input.revealedCount + 1); k <= hintCount; k += 1) {
        const targetRemainingMs = intervalMs * (hintCount - k + 1)
        if (input.currentRemainingMs >= targetRemainingMs)
          progressiveDelays.push(input.currentRemainingMs - targetRemainingMs)
      }
    }
  }

  let structuredDelay: number | undefined
  if (input.structuredHintsEnabled && input.hasStructuredHint && input.revealedHintCount === 0) {
    const targetRemainingMs = Math.round(input.totalMs * input.hintStartRatio)
    structuredDelay = Math.max(0, input.currentRemainingMs - targetRemainingMs)
  }
  return { progressiveDelays, ...(structuredDelay === undefined ? {} : { structuredDelay }) }
}
import { APP_CONFIG } from '../../../config/index.ts'
