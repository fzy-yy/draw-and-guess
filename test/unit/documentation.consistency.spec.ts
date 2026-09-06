import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('AGENTS 文档与工程入口一致性', () => {
  it('关键链接均存在且不再引用已删除的旧配置路径', () => {
    const root = process.cwd()
    const agents = readFileSync(resolve(root, 'AGENTS.md'), 'utf8')
    for (const path of [
      'config/index.ts',
      'string/index.ts',
      'apps/server/src/runtime.ts',
      'apps/client/src/stores/push-protocol.ts',
      'test/unit',
      'test/e2e',
      '.github/workflows/quality.yml',
    ])
      expect(existsSync(resolve(root, path)), `缺少 AGENTS 登记路径：${path}`).toBe(true)
    expect(agents).not.toContain('`config.ts`')
    expect(agents).not.toContain('`config/strings.ts`')
  })

  it('AGENTS 登记的质量命令在根 package.json 中存在', () => {
    const rootPackage = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>
    }
    for (const command of [
      'format',
      'format:check',
      'lint',
      'typecheck',
      'build',
      'test:unit',
      'test:e2e',
    ])
      expect(rootPackage.scripts?.[command], `缺少根命令：${command}`).toBeTruthy()
  })
})
