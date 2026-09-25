import { describe, expect, it } from 'vitest'
import { calculateGuessScore, countGraphemes, truncateGraphemes } from '@draw-guess/shared'
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

  it('词条权重缩放基础分后仍保持统一的速度/顺序计算', () => {
    const score = calculateGuessScore({
      elapsedMs: 1_000,
      durationMs: 10_000,
      correctOrder: 1,
      playerCount: 4,
      base: 600,
      maxSpeedBonus: 700,
      orderBonuses: [100],
    })
    expect(score).toEqual({ base: 600, speed: 630, order: 100, total: 1_330 })
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

  it('提示调度纯函数读取房间比例并避免重复结构化提示', () => {
    const schedule = createHintSchedule({
      totalMs: 100_000,
      currentRemainingMs: 60_000,
      progressiveHints: true,
      wordText: '测试词语',
      revealedCount: 1,
      structuredHintsEnabled: true,
      hasStructuredHint: true,
      revealedHintCount: 0,
      hintStartRatio: 0.35,
    })
    expect(schedule.structuredDelay).toBe(25_000)
    expect(schedule.progressiveDelays.length).toBeGreaterThan(0)
    expect(
      createHintSchedule({
        totalMs: 100_000,
        currentRemainingMs: 60_000,
        progressiveHints: true,
        wordText: '测试词语',
        revealedCount: 1,
        structuredHintsEnabled: true,
        hasStructuredHint: true,
        revealedHintCount: 1,
        hintStartRatio: 0.35,
      }).structuredDelay,
    ).toBeUndefined()
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
