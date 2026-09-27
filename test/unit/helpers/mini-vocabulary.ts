/**
 * 内存词库注册表（单元测试用）。
 *
 * 词面数据与 apps/server/src/vocabulary/test-fixture.ts 的 SQLite 管道共用单一数据源
 * buildWordSpecs（词条数默认 MIN_SELECTED_VOCABULARY_WORDS，不足则 startGame 拒绝）；
 * 字段符合 VocabularyWord（id/text/aliases/category/difficulty/drawability/hint/timeLimit/scoreWeight），
 * timeLimit/scoreWeight 为难度级 level_config 的加载期派生值。
 * 提供一个符合 VocabularyRegistry 接口的内存对象，让 GameService 在不开 SQLite、不读真实词库的前提下运转。
 */
import type { VocabularyWord } from '@draw-guess/shared'
import type { VocabularyRegistry } from '../../../apps/server/src/vocabulary/index.ts'
import {
  buildWordSpecs,
  TEST_WORD_CATEGORIES,
} from '../../../apps/server/src/vocabulary/test-word-specs.ts'

/** 测试用难度级配置：与真实词库 level_config 同构（全部词条共用同一时限/权重）。 */
const TEST_LEVEL_CONFIG = {
  1: { timeLimit: 90, scoreWeight: 5 },
  2: { timeLimit: 90, scoreWeight: 5 },
  3: { timeLimit: 90, scoreWeight: 5 },
  4: { timeLimit: 90, scoreWeight: 5 },
  5: { timeLimit: 90, scoreWeight: 5 },
} as const

/** 把共享词面规格映射为内存 VocabularyWord（id 前缀 sqlite: 贴合 Provider 产出的编号形态）。 */
function buildWords(count?: number): VocabularyWord[] {
  return buildWordSpecs(count).map((spec) => ({
    id: `sqlite:${spec.index}`,
    text: spec.text,
    aliases: [],
    category: spec.category,
    difficulty: spec.difficulty,
    drawability: spec.drawability,
    hint: spec.hint,
    // 时限/权重按难度从测试 level_config 派生（同 Provider 加载期语义）
    timeLimit: TEST_LEVEL_CONFIG[spec.difficulty as 1 | 2 | 3 | 4 | 5].timeLimit,
    scoreWeight: TEST_LEVEL_CONFIG[spec.difficulty as 1 | 2 | 3 | 4 | 5].scoreWeight,
  }))
}

/** 构建内存 VocabularyRegistry（单一词库包，id 命名为 base_words 以贴合现有快照与 UI 约定）。 */
export function createMemoryVocabularyRegistry(): VocabularyRegistry {
  const packageId = 'base_words'
  const items = buildWords()
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
      difficultyEnum: [1, 2, 3, 4, 5],
      drawabilityEnum: [1, 2, 3, 4, 5],
      levelConfig: TEST_LEVEL_CONFIG,
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
