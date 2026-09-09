import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('GameTransport 应用边界', () => {
  it('领域 Store 只消费注入的 transport，不再构造 requester 或导入 Socket 单例', () => {
    const stores = [
      'game.ts',
      'gameplay.ts',
      'lobby.ts',
      'profile.ts',
      'room.ts',
      'session.ts',
      'settings.ts',
      'vocabulary.ts',
    ]
      .map((file) => source(`../../apps/client/src/stores/${file}`))
      .join('\n')

    expect(stores).not.toMatch(/createRequester|from ['"]\.\/socket/u)
    expect(stores.match(/useGameTransport\(\)/gu)).toHaveLength(8)
  })

  it('生产入口只创建并注入一个 transport，Socket 模块不再导出实例', () => {
    const main = source('../../apps/client/src/main.ts')
    const socketLifecycle = source('../../apps/client/src/stores/socket.ts')

    expect(main.match(/createGameTransport\(/gu)).toHaveLength(1)
    expect(main.match(/installGameTransport\(/gu)).toHaveLength(1)
    expect(socketLifecycle).not.toMatch(/export const socket/u)
  })

  it('客户端测试不再全局 mock Socket 模块', () => {
    const testRoot = fileURLToPath(new URL('../../test', import.meta.url))
    const testSources = sourceFiles(testRoot)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')

    expect(testSources).not.toMatch(/vi\.mock\([^)]*stores\/socket/u)
  })
})
