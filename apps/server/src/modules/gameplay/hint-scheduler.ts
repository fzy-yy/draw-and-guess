/**
 * 回合逐步提示调度计算（纯函数）。
 *
 * 遵循架构约定（ADR-0001）：
 * 1. 结构化提示已废弃，仅按渐进间隔逐格揭示题目遮罩；
 * 2. 避免将提示坍缩到同一时刻；
 * 3. 保留末尾非标点字符，避免泄露答案。
 */
import { APP_CONFIG } from '../../core/config.ts'
import { isPunctuationOrSpace } from '@draw-guess/shared'

/**
 * 逐步提示计算入参。
 */
export interface HintScheduleInput {
  totalMs: number
  currentRemainingMs: number
  progressiveHints: boolean
  wordText: string
  revealedCount: number
}

/**
 * 逐步提示延时列表。
 */
export interface HintSchedule {
  progressiveDelays: number[]
}

/**
 * 计算逐步提示应触发的延时毫秒列表。
 */
export function createHintSchedule(input: HintScheduleInput): HintSchedule {
  const progressiveDelays: number[] = []
  if (input.progressiveHints) {
    const chars = Array.from(input.wordText)
    const nonPunctCount = chars.filter((char) => !isPunctuationOrSpace(char)).length
    const maxReveals = Math.max(0, nonPunctCount - 1)
    const hintCount = Math.min(Math.floor(chars.length / 2), maxReveals)
    if (hintCount > 0) {
      const windowMs = Math.max(0, input.totalMs * APP_CONFIG.game.progressiveHintRatio)
      const intervalMs = windowMs / hintCount
      for (let k = Math.max(1, input.revealedCount + 1); k <= hintCount; k += 1) {
        const targetRemainingMs = intervalMs * (hintCount - k + 1)
        if (input.currentRemainingMs >= targetRemainingMs) {
          progressiveDelays.push(input.currentRemainingMs - targetRemainingMs)
        }
      }
    }
  }

  return { progressiveDelays }
}
