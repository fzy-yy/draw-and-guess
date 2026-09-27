import { describe, expect, it } from 'vitest'
import { buildStartScript, buildUsageNotes } from '../../apps/server/src/build/dist-templates.ts'
import { MIN_NODE_MAJOR } from '../../apps/server/src/build/node-dist.ts'

/**
 * 分发文本模板（start.cmd / 使用说明.txt）：
 * 两包对终端用户的启动差异只允许由变体决定，关键行必须在无 IO 的情况下断言。
 */
describe('start.cmd 模板', () => {
  it('full 直接用内置运行时，不做任何系统 Node 检测', () => {
    const script = buildStartScript('full')
    expect(script).toContain('runtime\\node.exe server.mjs')
    expect(script).not.toContain('where node')
    expect(script).not.toContain('node --version')
  })

  it('slim 检测系统 Node，缺失或主版本低于常量时报错退出', () => {
    const script = buildStartScript('slim')
    expect(script).toContain('where node')
    expect(script).toContain(`if %NODE_MAJOR% LSS ${MIN_NODE_MAJOR} (`)
    expect(script).toContain('node server.mjs')
    expect(script).not.toContain('runtime\\node.exe')
  })

  it('两包共用批处理头尾（UTF-8 代码页、退出后暂停）', () => {
    for (const variant of ['slim', 'full'] as const) {
      const script = buildStartScript(variant)
      expect(script.startsWith('@echo off\r\n')).toBe(true)
      expect(script).toContain('chcp 65001 >nul')
      expect(script.trimEnd().endsWith('pause >nul')).toBe(true)
    }
  })
})

describe('使用说明.txt 模板', () => {
  it('运行要求按变体区分：full 免安装、slim 给出 Node 版本要求', () => {
    const full = buildUsageNotes('2.5.0', 'full')
    const slim = buildUsageNotes('2.5.0', 'slim')
    expect(full).toContain('本包已内置 Node 运行时，无需安装 Node.js')
    expect(full).toContain('runtime/ 目录')
    expect(slim).toContain(`Node.js ${MIN_NODE_MAJOR} 或更高版本`)
    expect(slim).not.toContain('内置 Node 运行时')
  })

  it('标题带上注入的版本号，正文其余章节两包一致', () => {
    expect(buildUsageNotes('9.9.9', 'full')).toContain('「你画我猜」 v9.9.9')
    expect(buildUsageNotes('9.9.9', 'slim')).toContain('「你画我猜」 v9.9.9')
    for (const variant of ['slim', 'full'] as const) {
      const notes = buildUsageNotes('2.5.0', variant)
      expect(notes).toContain('data/vocabulary/custom/')
      expect(notes).toContain('请勿开放到公网')
    }
  })

  it('文本以 CRLF 行尾落稿（Windows 分发口径）', () => {
    const notes = buildUsageNotes('2.5.0', 'slim')
    expect(notes).toContain('\r\n')
    expect(notes).not.toMatch(/(?<!\r)\n/)
  })
})
