import { describe, expect, it } from 'vitest'
import { createHintSchedule } from '../../apps/server/src/hint-scheduler.ts'
import { isPrivateIpv4 } from '../../apps/server/src/startup/lan-addresses.ts'
import { normalizeAnswer } from '@draw-guess/shared'

describe('缺陷修复回归：normalizeAnswer 本地化不敏感', () => {
  it('统一用 toLowerCase，结果与主机 locale 无关（土耳其语 I 不再折叠为点 i）', () => {
    // toLocaleLowerCase 在 tr 宿主下会把 'I' 折叠为 'ı'；修复后 toLowerCase 恒为 'i'。
    expect(normalizeAnswer('I')).toBe('i')
    expect(normalizeAnswer('ISTANBUL')).toBe('istanbul')
  })

  it('NFKC + 去空白 + 折叠连续空白仍生效', () => {
    expect(normalizeAnswer('  Hello　World  ')).toBe('hello world')
  })
})

describe('缺陷修复回归：逐步提示间隔不再坍缩为零', () => {
  it('长答案（hintCount > windowSec）时仍按毫秒均匀散布，不坍缩到同一时刻', () => {
    // 90s 回合、后半窗 45s；120 字符 → hintCount=60 > 45，旧版 floor(45/60)=0 → 全部 delay 相同。
    const schedule = createHintSchedule({
      totalMs: 90_000,
      currentRemainingMs: 90_000,
      progressiveHints: true,
      wordText: '长'.repeat(120),
      revealedCount: 0,
    })
    expect(schedule.progressiveDelays.length).toBe(60)
    // 每个 delay 互不相同且递增（首提示在后半窗起点，末提示临近回合结束）
    expect(new Set(schedule.progressiveDelays).size).toBe(60)
    expect(schedule.progressiveDelays[0]).toBeLessThan(schedule.progressiveDelays[59]!)
    expect(schedule.progressiveDelays.every((delay) => delay > 0)).toBe(true)
  })

  it('标点密集答案：提示数按可揭示字符封顶，不调度出空转计时器', () => {
    // "a，b，c，d"：7 个字符中 4 个非标点，揭示会保留最后一个 → 最多 3 个提示；
    // 旧版按 floor(7/2)=4 会调度出一个永不揭示（空转）的计时器。
    const schedule = createHintSchedule({
      totalMs: 90_000,
      currentRemainingMs: 90_000,
      progressiveHints: true,
      wordText: 'a，b，c，d',
      revealedCount: 0,
    })
    expect(schedule.progressiveDelays.length).toBe(3)
  })
})

describe('缺陷修复回归：局域网地址只报私网', () => {
  it('isPrivateIpv4 放行 RFC1918 私网、拒绝公网/CGNAT/回环/链路本地', () => {
    expect(isPrivateIpv4('10.0.0.1')).toBe(true)
    expect(isPrivateIpv4('192.168.1.2')).toBe(true)
    expect(isPrivateIpv4('172.16.0.1')).toBe(true)
    expect(isPrivateIpv4('172.31.255.254')).toBe(true)
    expect(isPrivateIpv4('172.32.0.1')).toBe(false)
    expect(isPrivateIpv4('8.8.8.8')).toBe(false)
    expect(isPrivateIpv4('100.64.0.1')).toBe(false) // CGNAT/Tailscale
    expect(isPrivateIpv4('127.0.0.1')).toBe(false) // 回环
    expect(isPrivateIpv4('169.254.10.1')).toBe(false) // 链路本地
  })
})
