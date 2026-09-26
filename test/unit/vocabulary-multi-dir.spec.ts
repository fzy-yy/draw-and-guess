import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMinimalVocabularyDb } from '../../apps/server/src/vocabulary/test-fixture.ts'
import { loadVocabulary } from '../../apps/server/src/vocabulary/index.ts'

/**
 * 多目录词库合并（分发产物「内置 vocabulary/ + 数据目录 custom/」）的行为守卫：
 * 两个目录都要被扫描、按词数选默认包、同名包 ID 唯一化。
 */
const created: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'draw-guess-vocab-dirs-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('多目录词库合并', () => {
  it('合并内置与自定义目录，并按词数最多选择默认包', async () => {
    const builtinDir = tempDir()
    const customDir = tempDir()
    createMinimalVocabularyDb(join(builtinDir, 'base_words.db'), { wordCount: 60 })
    createMinimalVocabularyDb(join(customDir, 'my_words.db'), { wordCount: 80 })

    const registry = await loadVocabulary([builtinDir, customDir])

    expect(registry.packages.map((item) => item.id).sort()).toEqual(['base_words', 'my_words'])
    expect(registry.defaultPackageId).toBe('my_words')
    expect(registry.items).toHaveLength(80)
  })

  it('不同目录的同名词库 ID 唯一化，避免相互覆盖', async () => {
    const builtinDir = tempDir()
    const customDir = tempDir()
    createMinimalVocabularyDb(join(builtinDir, 'base_words.db'), { wordCount: 60 })
    createMinimalVocabularyDb(join(customDir, 'base_words.db'), { wordCount: 70 })

    const registry = await loadVocabulary([builtinDir, customDir])

    expect(registry.packages).toHaveLength(2)
    expect(registry.packages.map((item) => item.id).sort()).toEqual(['base_words', 'base_words-2'])
    expect(registry.get('base_words')?.items).toHaveLength(60)
    expect(registry.get('base_words-2')?.items).toHaveLength(70)
  })
})
