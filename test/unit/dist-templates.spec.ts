import { describe, expect, it } from 'vitest'
import { buildStartScript, buildUsageNotes } from '../../apps/server/src/build/dist-templates.ts'
import { MIN_NODE_MAJOR } from '../../apps/server/src/build/node-dist.ts'

/**
 * 分发文本模板（start.cmd / 使用说明.txt）：
 * 两包对终端用户的启动差异只允许由变体决定，关键行必须在无 IO 的情况下断言。
 * 端口一律传入与真实默认值不同的测试值，避免用例与私有配置两处各写一份。
 */
const TEST_PORT = 6000
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
    const full = buildUsageNotes('2.5.0', 'full', TEST_PORT)
    const slim = buildUsageNotes('2.5.0', 'slim', TEST_PORT)
    expect(full).toContain('本包已内置 Node 运行时，无需安装 Node.js')
    expect(full).toContain('runtime/ 目录')
    expect(slim).toContain(`Node.js ${MIN_NODE_MAJOR} 或更高版本`)
    expect(slim).not.toContain('内置 Node 运行时')
  })

  it('端口文案由参数派生：不再硬编码默认端口', () => {
    const notes = buildUsageNotes('2.5.0', 'slim', TEST_PORT)
    expect(notes).toContain(`http://192.168.x.x:${TEST_PORT}`)
    expect(notes).toContain(`端口 ${TEST_PORT} 被占用`)
    // 传入非默认端口时旧硬编码值不得残留，防止「模板与私有配置两处维护」回潮。
    expect(notes).not.toContain('5174')
  })

  it('标题带上注入的版本号，正文其余章节两包一致', () => {
    expect(buildUsageNotes('9.9.9', 'full', TEST_PORT)).toContain('「你画我猜」 v9.9.9')
    expect(buildUsageNotes('9.9.9', 'slim', TEST_PORT)).toContain('「你画我猜」 v9.9.9')
    for (const variant of ['slim', 'full'] as const) {
      const notes = buildUsageNotes('2.5.0', variant, TEST_PORT)
      expect(notes).toContain('data/vocabulary/custom/')
      expect(notes).toContain('请勿开放到公网')
    }
  })

  it('文本以 CRLF 行尾落稿（Windows 分发口径）', () => {
    const notes = buildUsageNotes('2.5.0', 'slim', TEST_PORT)
    expect(notes).toContain('\r\n')
    expect(notes).not.toMatch(/(?<!\r)\n/)
  })
})
