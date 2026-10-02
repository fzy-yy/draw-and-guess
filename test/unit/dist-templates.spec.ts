import { describe, expect, it } from 'vitest'
import { buildStartScript, buildUsageNotes } from '../../apps/server/src/build/dist-templates.ts'
import { BUNDLED_NODE_MAJOR } from '../../apps/server/src/build/node-dist.ts'

/**
 * 分发文本模板（start.cmd / 使用说明.txt）：
 * 分发包始终自带内置 Node，关键启动行必须在无 IO 的情况下断言。
 * 端口一律传入与真实默认值不同的测试值，避免用例与私有配置两处各写一份。
 */
const TEST_PORT = 6000

describe('start.cmd 模板', () => {
  it('直接用内置运行时，不做任何系统 Node 检测', () => {
    const script = buildStartScript()
    expect(script).toContain('runtime\\node.exe server.mjs')
    expect(script).not.toContain('where node')
    expect(script).not.toContain('node --version')
    expect(script).not.toContain('full')
    expect(script).not.toContain('slim')
  })

  it('批处理头尾（UTF-8 代码页、退出后暂停）齐全', () => {
    const script = buildStartScript()
    expect(script.startsWith('@echo off\r\n')).toBe(true)
    expect(script).toContain('chcp 65001 >nul')
    expect(script.trimEnd().endsWith('pause >nul')).toBe(true)
  })
})

describe('使用说明.txt 模板', () => {
  it('运行要求声明内置 Node、无需安装，且不再出现 full/slim 字样', () => {
    const notes = buildUsageNotes('2.5.0', TEST_PORT)
    expect(notes).toContain('本包已内置 Node 运行时，无需安装 Node.js')
    expect(notes).toContain(`内置 Node ${BUNDLED_NODE_MAJOR} LTS 运行时在 runtime/ 目录`)
    expect(notes).not.toContain('full')
    expect(notes).not.toContain('slim')
  })

  it('端口文案由参数派生：不再硬编码默认端口', () => {
    const notes = buildUsageNotes('2.5.0', TEST_PORT)
    expect(notes).toContain(`http://192.168.x.x:${TEST_PORT}`)
    expect(notes).toContain(`端口 ${TEST_PORT} 被占用`)
    // 传入非默认端口时旧硬编码值不得残留，防止「模板与私有配置两处维护」回潮。
    expect(notes).not.toContain('5174')
  })

  it('标题带上注入的版本号，正文含词库与安全提示', () => {
    const notes = buildUsageNotes('9.9.9', TEST_PORT)
    expect(notes).toContain('「你画我猜」 v9.9.9')
    expect(notes).toContain('data/vocabulary/custom/')
    expect(notes).toContain('vocabulary/templates/example.db')
    expect(notes).toContain('请勿开放到公网')
  })

  it('文本以 CRLF 行尾落稿（Windows 分发口径）', () => {
    const notes = buildUsageNotes('2.5.0', TEST_PORT)
    expect(notes).toContain('\r\n')
    expect(notes).not.toMatch(/(?<!\r)\n/)
  })
})
