import { hostname } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  findLocalHostnames,
  localHostnameCandidates,
} from '../../apps/server/src/startup/local-hostnames.ts'

/**
 * 本机名字候选取值面（见 docs/adr/0037-allow-local-hostname-origin.md）：
 * 只覆盖「同一台机器自己的名字」的几种写法，多猜一种写法就是多开一扇放行门。
 */
describe('本机名字候选', () => {
  it('无点写法：原样名字 + .local 形态', () => {
    expect(localHostnameCandidates('my-pc')).toEqual(['my-pc', 'my-pc.local'])
  })

  it('FQDN 写法：额外补首个标签（短名）及其 .local 形态', () => {
    expect(localHostnameCandidates('mbp.example.com')).toEqual([
      'mbp.example.com',
      'mbp.example.com.local',
      'mbp',
      'mbp.local',
    ])
  })

  it('已是 .local 结尾时不重复追加后缀，但仍补出无后缀的短名', () => {
    // 报告值本身就是多段名：`.local` 形态原样保留，首段（无后缀写法）也补进来——
    // 两者指向同一台机器，而无后缀写法正是玩家可能手输的那一种。
    expect(localHostnameCandidates('My-PC.local')).toEqual(['My-PC.local', 'My-PC'])
  })

  it('FQDN 的根点（尾部点）等价于无点写法，不派生 `.local.` 一类无从解析的名字', () => {
    expect(localHostnameCandidates('mbp.example.com.')).toEqual([
      'mbp.example.com',
      'mbp.example.com.local',
      'mbp',
      'mbp.local',
    ])
  })

  it('首尾空白先去掉；空值与只有点的退化写法不产出任何候选', () => {
    expect(localHostnameCandidates('  my-pc  ')).toEqual(['my-pc', 'my-pc.local'])
    for (const degenerate of ['', '   ', '.', '..']) {
      expect(localHostnameCandidates(degenerate), degenerate).toEqual([])
    }
  })

  it('findLocalHostnames 至少包含操作系统报告的名字（含其 .local 形态）', () => {
    const reported = hostname()
    if (!reported.trim()) return // 极端环境（拿不到本机名）下无从断言，跳过
    const candidates = findLocalHostnames()
    expect(candidates).toContain(reported)
    expect(candidates).toContain(`${reported}.local`)
  })
})
