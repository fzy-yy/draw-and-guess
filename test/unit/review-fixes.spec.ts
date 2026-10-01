import { describe, expect, it } from 'vitest'
import { countGraphemes, guessScoreForOrder, truncateGraphemes } from '@draw-guess/shared'
import { enforceEventRate } from '../../apps/server/src/rate-limit.ts'
import { GameError } from '../../apps/server/src/errors.ts'
import type { PlayerSecret } from '../../apps/server/src/models.ts'
import { createHintSchedule } from '../../apps/server/src/hint-scheduler.ts'
import {
  getCanvasBackingSize,
  getDisplayCanvasSize,
} from '../../apps/client/src/canvas/viewport.ts'

describe('审查缺陷回归：共享规则与限频', () => {
  it('按 grapheme 统计并截断昵称，不拆分 emoji 组合字符', () => {
    const nickname = '👩🏽‍💻abc'
    expect(countGraphemes(nickname)).toBe(4)
    expect(truncateGraphemes(nickname, 1)).toBe('👩🏽‍💻')
  })

  it('猜中得分只由顺序决定，超出得分表长度时取最低档', () => {
    const orderScores = [100, 80, 60, 40, 20]
    expect(guessScoreForOrder(1, orderScores)).toBe(100)
    expect(guessScoreForOrder(5, orderScores)).toBe(20)
    // 6 人局第 6 名仍拿最低分，而不是 0 分
    expect(guessScoreForOrder(6, orderScores)).toBe(20)
    // 防御：越界与非整数顺序不产生 NaN
    expect(guessScoreForOrder(0, orderScores)).toBe(100)
    expect(guessScoreForOrder(2.7, orderScores)).toBe(80)
    // 防御：空得分表（配置误置空数组）返回 0 而不是崩溃
    expect(guessScoreForOrder(1, [])).toBe(0)
  })

  it('限频使用注入时间，不依赖系统时钟', () => {
    const player = {
      guessEventTimes: [],
      drawEventTimes: [],
    } as unknown as PlayerSecret
    const clock = { now: () => 10_000 }
    enforceEventRate(player, 'guess', clock)
    for (let index = 1; index < 5; index += 1)
      expect(() => enforceEventRate(player, 'guess', clock)).not.toThrow()
    expect(player.guessEventTimes).toHaveLength(5)
    expect(() => enforceEventRate(player, 'guess', clock)).toThrow(GameError)
  })

  it('逐步提示调度按已揭示数量跳过已用槽位，只返回未来提示延迟', () => {
    const schedule = createHintSchedule({
      totalMs: 100_000,
      currentRemainingMs: 60_000,
      progressiveHints: true,
      wordText: '测试词语',
      revealedCount: 1,
    })
    expect(schedule.progressiveDelays.length).toBeGreaterThan(0)
    // 已揭示 1 个后重算：调度出的延迟里不应再包含已消费的首个提示槽位。
    const full = createHintSchedule({
      totalMs: 100_000,
      currentRemainingMs: 100_000,
      progressiveHints: true,
      wordText: '测试词语',
      revealedCount: 0,
    })
    expect(schedule.progressiveDelays.length).toBe(full.progressiveDelays.length - 1)
  })

  it('画布 backing size 只由 CSS 宽高与逻辑分辨率决定', () => {
    expect(getCanvasBackingSize(1280, 720, 720)).toEqual({ width: 1280, height: 720 })
    expect(getCanvasBackingSize(640, 360, 720)).toEqual({ width: 1280, height: 720 })
  })

  it.each([
    [0.75, 800, 600, 600, 450],
    [1, 1280, 720, 1280, 720],
    [1.5, 1280, 720, 1920, 1080],
    [2, 360, 720, 720, 1440],
    [3, 900, 600, 1800, 1200],
  ])(
    '展示层按 DPR %s 和宽高比分配独立 backing store',
    (dpr, cssWidth, cssHeight, width, height) => {
      expect(getDisplayCanvasSize(cssWidth, cssHeight, dpr, 2)).toEqual({
        width,
        height,
        scale: Math.min(dpr, 2),
      })
    },
  )
})
