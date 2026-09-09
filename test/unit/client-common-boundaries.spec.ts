import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|vue)$/u.test(entry.name) ? [path] : []
  })
}

describe('客户端通用组件边界', () => {
  it('components/common 不读取 Facade、领域 Store 或应用配置', () => {
    const commonRoot = fileURLToPath(
      new URL('../../apps/client/src/components/common', import.meta.url),
    )
    const sources = sourceFiles(commonRoot)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')

    expect(sources).not.toMatch(/@\/stores|@draw-guess\/config|useGameStore/u)
  })

  it('DataTableColumn 从普通 TypeScript 模块导出且调用方不依赖 SFC 类型', () => {
    const clientRoot = fileURLToPath(new URL('../../apps/client/src', import.meta.url))
    const sources = sourceFiles(clientRoot)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    const types = readFileSync(join(clientRoot, 'components/common/data-table.types.ts'), 'utf8')

    expect(types).toContain('export interface DataTableColumn')
    expect(sources).not.toMatch(
      /import\s+type\s+\{\s*DataTableColumn\s*\}\s+from\s+['"][^'"]*\.vue['"]/u,
    )
  })
})
