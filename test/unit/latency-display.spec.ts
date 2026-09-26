import { describe, expect, it } from 'vitest'
import { strings } from '@draw-guess/strings'

describe('网络延迟展示封顶（strings 单一口径）', () => {
  it('超过上限的延迟按三位数封顶，避免徽章数字溢出', () => {
    expect(strings.common.latencyShort(1500)).toBe('999ms')
    expect(strings.common.latencyShort(999)).toBe('999ms')
    expect(strings.common.latencyShort(24)).toBe('24ms')
  })

  it('悬浮与无障碍文案复用同一封顶值', () => {
    expect(strings.common.connectionDetail('已连接', 4321)).toBe('已连接 · 999 ms')
    expect(strings.common.networkStatusAria('已连接', 4321)).toBe('已连接 · 延迟 999 毫秒')
  })

  it('未测得（0）仍显示占位符而非 0ms', () => {
    expect(strings.common.connectionDetail('已连接', 0)).toBe('已连接 · — ms')
    expect(strings.common.networkStatusAria('已连接', 0)).toBe('已连接 · 延迟 — 毫秒')
  })
})
