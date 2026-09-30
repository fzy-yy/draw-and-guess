import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { logFileName, prepareLogDir } from '../../apps/server/src/logging/file-logger.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'draw-guess-logger-'))
  temporaryDirectories.push(directory)
  return directory
}

/** 等待真实时间推进，确保两次文件创建在文件系统里有可分辨的 birthtime，避免排序并列。 */
function waitForDistinctCreationTime(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25))
}

describe('日志文件命名与保留策略', () => {
  it('同秒内重复启动时文件名后缀递增，绝不覆盖既有日志', () => {
    // 假时钟钉住秒级时间戳，消除跨秒边界带来的偶发失败（prepareLogDir 与 logFileName 同源）。
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 2, 3, 4, 5))
    const logDir = temporaryDirectory()

    // 模拟第一次启动已落盘同秒日志文件。
    const first = logFileName()
    writeFileSync(join(logDir, first), '第一次启动')

    // 第二次启动：同秒重名必须顺延到 -2。
    const second = prepareLogDir(10, logDir)
    expect(basename(second)).toBe('app-2026-01-02-03-04-05-2.log')

    // 模拟第二次启动真正落盘后，同秒第三次启动继续顺延到 -3。
    writeFileSync(second, '第二次启动')
    const third = prepareLogDir(10, logDir)
    expect(basename(third)).toBe('app-2026-01-02-03-04-05-3.log')

    // 既有日志内容必须原样保留，后缀顺延不允许覆盖。
    expect(readFileSync(join(logDir, first), 'utf8')).toBe('第一次启动')
    expect(readFileSync(second, 'utf8')).toBe('第二次启动')
  })

  it('超过保留条数时按创建时间删最旧，字典序靠前的后建文件不被误删', async () => {
    const logDir = temporaryDirectory()
    // 先建 -10（实际更旧）再建 -02（实际更新）：若实现按文件名排序会错删 -02（见 ADR-0005）。
    const older = join(logDir, 'app-2025-12-31-23-59-10.log')
    const newer = join(logDir, 'app-2025-12-31-23-59-02.log')
    const unrelated = join(logDir, 'notes.txt')
    writeFileSync(older, '更早启动')
    await waitForDistinctCreationTime()
    writeFileSync(newer, '更晚启动')
    writeFileSync(unrelated, '非日志文件')

    // maxFiles=2 且已有 2 个日志：新日志即将创建，必须删掉最旧的 -10。
    const created = prepareLogDir(2, logDir)

    expect(existsSync(older)).toBe(false)
    expect(existsSync(newer)).toBe(true)
    // 非 *.log 文件不参与清理（见 ADR-0005）。
    expect(existsSync(unrelated)).toBe(true)
    expect(created.startsWith(logDir)).toBe(true)
  })

  it('删除旧日志失败时跳过该文件继续清理，不阻断启动', () => {
    const logDir = temporaryDirectory()
    // 目录无法被 unlinkSync 删除（Windows 抛 EPERM、其它平台抛 EISDIR），
    // 用它稳定模拟「旧日志被另一实例占用删不掉」，无需 mock 文件系统。
    const stuck = join(logDir, 'app-2025-12-31-23-59-10.log')
    mkdirSync(stuck)
    const removable = join(logDir, 'app-2025-12-31-23-59-20.log')
    writeFileSync(removable, '旧日志')

    // maxFiles=1 时两个旧文件都在清理名单里：删不掉的目录被跳过，可删的文件照常清理。
    expect(() => prepareLogDir(1, logDir)).not.toThrow()
    expect(existsSync(stuck)).toBe(true)
    expect(existsSync(removable)).toBe(false)
  })
})
