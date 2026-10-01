/**
 * 内存词库注册表（单元测试用）。
 *
 * 词面数据与 apps/server/src/vocabulary/test-fixture.ts 的 SQLite 管道共用单一数据源
 * buildWordSpecs（词条数默认 MIN_SELECTED_VOCABULARY_WORDS，不足则 startGame 拒绝）；
 * 字段符合 VocabularyWord（id/text/aliases/category）——难度/可绘制性/提示与派生时限权重
 * 已随词库瘦身移除（见 docs/adr/0046-vocabulary-slimming-and-unified-round-time.md）。
 * 提供一个符合 VocabularyRegistry 接口的内存对象，让 GameService 在不开 SQLite、不读真实词库的前提下运转。
 */
import type { VocabularyWord } from '@draw-guess/shared'
import type { VocabularyRegistry } from '../../../apps/server/src/vocabulary/index.ts'
import {
  buildWordSpecs,
  TEST_WORD_CATEGORIES,
} from '../../../apps/server/src/vocabulary/test-word-specs.ts'

/** 把共享词面规格映射为内存 VocabularyWord（id 前缀 sqlite: 贴合 Provider 产出的编号形态）。 */
function buildWords(count?: number): VocabularyWord[] {
  return buildWordSpecs(count).map((spec) => ({
    id: `sqlite:${spec.index}`,
    text: spec.text,
    aliases: [],
    category: spec.category,
  }))
}

/**
 * 构建内存 VocabularyRegistry（单一词库包，id 命名为 base_words 以贴合现有快照与 UI 约定）。
 * wordCount 缺省为开局裁决线（buildWordSpecs 默认值）；可传更小值以验证「包词数不足」的门槛。
 */
export function createMemoryVocabularyRegistry(wordCount?: number): VocabularyRegistry {
  const packageId = 'base_words'
  const items = buildWords(wordCount)
  const byId = new Map(items.map((word) => [word.id, word]))
  const store = {
    items,
    byId,
    version: 'test-hash-v1',
    meta: {
      sourceId: 'sqlite',
      id: packageId,
      name: '最小测试词库',
      description: '内存单测词库',
      fileVersion: '1.0.0',
      updatedAt: '2026-01-01T00:00:00.000Z',
      categoryEnum: [...TEST_WORD_CATEGORIES],
      wordCount: items.length,
    },
  }
  return {
    ...store,
    packages: [
      {
        id: packageId,
        name: '最小测试词库',
        wordCount: items.length,
        description: '内存单测词库',
        version: '1.0.0',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    defaultPackageId: packageId,
    get: (id: string) => (id === packageId ? store : undefined),
    getDefault: () => store,
  } as unknown as VocabularyRegistry
}
