import { describe, expect, it } from 'vitest'
import { createHintSchedule } from '../../apps/server/src/hint-scheduler.ts'

/**
 * 逐步提示调度的纯函数契约（结构化提示已移除，只保留逐字遮罩节奏，见 ADR-0042）：
 * 到点揭示、只调度未来槽位、长答案不坍缩、标点密集答案按可揭示字符封顶。
 */

describe('createHintSchedule 逐字遮罩节奏', () => {
  it('关闭逐步提示时不调度任何计时器', () => {
    const schedule = createHintSchedule({
      totalMs: 100_000,
      currentRemainingMs: 100_000,
      progressiveHints: false,
      wordText: '测试词语',
      revealedCount: 0,
    })
    expect(schedule.progressiveDelays).toEqual([])
  })

  it('全部提示落在后半窗口且按时间递增，到点才揭示', () => {
    // 100s 回合、后半窗 50s；4 字答案 → 最多 2 个提示，间隔 25s。
    const schedule = createHintSchedule({
      totalMs: 100_000,
      currentRemainingMs: 100_000,
      progressiveHints: true,
      wordText: '测试词语',
      revealedCount: 0,
    })
    expect(schedule.progressiveDelays).toEqual([50_000, 75_000])

    // 剩余 30s 时重算：只保留尚未到点的槽位，已错过的首提示不再补发。
    const late = createHintSchedule({
      totalMs: 100_000,
      currentRemainingMs: 30_000,
      progressiveHints: true,
      wordText: '测试词语',
      revealedCount: 1,
    })
    expect(late.progressiveDelays).toEqual([5_000])
  })

  it('长答案不坍缩为同一时刻（毫秒级均匀散布）', () => {
    // 120 字 → 60 个提示，远多于窗口秒数；旧版按秒取整会全部坍缩。
    const schedule = createHintSchedule({
      totalMs: 90_000,
      currentRemainingMs: 90_000,
      progressiveHints: true,
      wordText: '长'.repeat(120),
      revealedCount: 0,
    })
    expect(schedule.progressiveDelays).toHaveLength(60)
    expect(new Set(schedule.progressiveDelays).size).toBe(60)
    expect(schedule.progressiveDelays[0]).toBeLessThan(schedule.progressiveDelays[59]!)
  })

  it('标点密集答案按可揭示字符封顶，不调度空转计时器（保留末尾非标点字符）', () => {
    // "a，b，c，d"：4 个非标点字符，揭示保留最后一个 → 最多 3 个提示。
    const schedule = createHintSchedule({
      totalMs: 90_000,
      currentRemainingMs: 90_000,
      progressiveHints: true,
      wordText: 'a，b，c，d',
      revealedCount: 0,
    })
    expect(schedule.progressiveDelays).toHaveLength(3)
  })
})
