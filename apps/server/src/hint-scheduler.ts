import { APP_CONFIG } from './config/index.ts'

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
    // 只调度能真正揭示的提示数：revealHint 会保留最后一个非标点字符（避免泄露答案），
    // 故最多能揭示 nonPunctCount-1 个；含大量标点的答案以此封顶，避免调度出空转计时器（#9）。
    const chars = Array.from(input.wordText)
    const nonPunctCount = chars.filter((char) => !/^[\p{P}\p{Z}\s]$/u.test(char)).length
    const maxReveals = Math.max(0, nonPunctCount - 1)
    const hintCount = Math.min(Math.floor(chars.length / 2), maxReveals)
    if (hintCount > 0) {
      // 用毫秒计算间隔，避免 Math.floor(windowSec/hintCount)=0 时把所有提示坍缩到同一时刻
      //（否则长答案会失去全部逐步提示，见 docs/adr/0001-progressive-hint-interval.md）。
      const windowMs = Math.max(0, input.totalMs * APP_CONFIG.game.progressiveHintRatio)
      const intervalMs = windowMs / hintCount
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
