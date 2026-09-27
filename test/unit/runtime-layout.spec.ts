import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRuntimeLayout } from '../../apps/server/src/runtime-layout.ts'

/**
 * 运行时资源布局解析守卫：
 * 分发产物（dist）以入口文件所在目录为根；源码模式沿用仓库相对路径，且不自动顺延端口/开浏览器
 * （否则会破坏 Vite 固定 5174 代理）。
 */
describe('运行时资源布局解析', () => {
  it('产物模式：资源相对入口目录解析，开启端口顺延与自动开浏览器', () => {
    // 产物模式只做 join 拼接、不调用 resolve，故这里用 Windows 风格安装路径模拟分发包
    // 也不会在 POSIX 上出问题（正因如此才固定住「产物模式不做路径归一化」这一事实）。
    const entryDir = join('F:', 'app', 'draw-and-guess')
    const layout = resolveRuntimeLayout({ mode: 'dist', entryDir })

    expect(layout.mode).toBe('dist')
    expect(layout.baseDir).toBe(entryDir)
    expect(layout.databaseFile).toBe(join(entryDir, 'data', 'game.db'))
    expect(layout.logDir).toBe(join(entryDir, 'data', 'logs'))
    expect(layout.vocabularyDirs).toEqual([
      join(entryDir, 'vocabulary'),
      join(entryDir, 'data', 'vocabulary', 'custom'),
    ])
    expect(layout.clientDist).toBe(join(entryDir, 'client'))
    expect(layout.envFile).toBe(join(entryDir, 'data', '.env'))
    expect(layout.portFallback).toBe(true)
    expect(layout.openBrowser).toBe(true)
  })

  it('源码模式：沿用仓库相对路径，端口固定且不自动开浏览器', () => {
    // 源码模式内部经 path.resolve 归一化，必须传入真实的绝对路径：
    // 伪造盘符（如 join('F:', 'repo')）在 POSIX 上是相对路径，会被拼到 cwd 前面而误判，
    // 因此这里从测试文件位置（test/unit/）上溯两级取真实仓库根，Windows/Linux 均成立。
    const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
    const entryDir = join(repoRoot, 'apps', 'server', 'src')
    const layout = resolveRuntimeLayout({ mode: 'source', entryDir })

    expect(layout.mode).toBe('source')
    expect(layout.baseDir).toBe(resolve(repoRoot, 'apps', 'server'))
    expect(layout.databaseFile).toBe(join(repoRoot, 'apps', 'server', 'data', 'game.db'))
    expect(layout.logDir).toBe(join(repoRoot, 'apps', 'server', 'log'))
    expect(layout.vocabularyDirs).toEqual([join(repoRoot, 'vocabulary')])
    expect(layout.clientDist).toBe(join(repoRoot, 'apps', 'client', 'dist'))
    expect(layout.envFile).toBe(join(repoRoot, '.env'))
    expect(layout.portFallback).toBe(false)
    expect(layout.openBrowser).toBe(false)
  })
})
