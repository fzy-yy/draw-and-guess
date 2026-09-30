import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadProjectEnv } from '../../apps/server/src/startup/environment.ts'

/**
 * 配置文件加载的失败姿态（隔离环境）：用例只在系统临时目录里造文件，不触碰仓库真实 `.env`；
 * 加载成功路径用一个专用键做标记，用例后清理，避免污染进程环境。
 */

const MARKER_KEY = 'DRAW_GUESS_TEST_ENV_MARKER'
const createdDirectories: string[] = []

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'draw-guess-env-'))
  createdDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  delete process.env[MARKER_KEY]
})

describe('配置文件加载', () => {
  it('文件不存在时静默跳过：.env 本就是可选配置', () => {
    expect(() => loadProjectEnv(join(makeTemporaryDirectory(), '.env'))).not.toThrow()
  })

  it('带 UTF-8 BOM 的配置文件启动即中止，文案点名成因与修正办法', () => {
    const envPath = join(makeTemporaryDirectory(), '.env')
    writeFileSync(
      envPath,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${MARKER_KEY}=loaded\n`)]),
    )
    expect(() => loadProjectEnv(envPath)).toThrow(/UTF-8 BOM/u)
    expect(() => loadProjectEnv(envPath)).toThrow(/UTF-8 无 BOM/u)
    // 关键：BOM 文件必须整份不生效——旧实现会照常加载，首个配置项被 BOM 顶掉后静默失效。
    expect(process.env[MARKER_KEY]).toBeUndefined()
  })

  it('配置文件读取失败（路径是目录）时抛带错误码的运维文案，不静默取缺省', () => {
    const asDirectory = join(makeTemporaryDirectory(), '.env')
    mkdirSync(asDirectory)
    expect(() => loadProjectEnv(asDirectory)).toThrow(/无法读取/u)
    expect(() => loadProjectEnv(asDirectory)).toThrow(/错误码 [A-Z0-9]+/u)
  })

  it('正常文件按 Node 口径加载（进程已有变量优先由 loadEnvFile 保证）', () => {
    const envPath = join(makeTemporaryDirectory(), '.env')
    writeFileSync(envPath, `${MARKER_KEY}=loaded\n`)
    expect(() => loadProjectEnv(envPath)).not.toThrow()
    expect(process.env[MARKER_KEY]).toBe('loaded')
  })
})
