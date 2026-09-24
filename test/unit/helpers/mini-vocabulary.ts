/**
 * 内存词库注册表（单元测试用）。
 *
 * 与 apps/server/src/vocabulary/test-fixture.ts 生成的最小词库同构：词条数 ≥ MIN_SELECTED_VOCABULARY_WORDS(60)，
 * 字段符合 VocabularyWord（id/text/aliases/category/difficulty/drawability/hint/timeLimit/scoreWeight），
 * category 属于 category_enum 白名单，difficulty/drawability 落在合法枚举区间，
 * timeLimit/scoreWeight 为难度级 level_config 的加载期派生值。
 * 提供一个符合 VocabularyRegistry 接口的内存对象，让 GameService 在不开 SQLite、不读真实词库的前提下运转。
 */
import type { VocabularyWord } from '@draw-guess/shared'
import type { VocabularyRegistry } from '../../../apps/server/src/vocabulary/index.ts'

const CATEGORIES = ['物品', '动物', '动作'] as const

/** 测试用难度级配置：与真实词库 level_config 同构（全部词条共用同一时限/权重）。 */
const TEST_LEVEL_CONFIG = {
  1: { timeLimit: 90, scoreWeight: 5 },
  2: { timeLimit: 90, scoreWeight: 5 },
  3: { timeLimit: 90, scoreWeight: 5 },
  4: { timeLimit: 90, scoreWeight: 5 },
  5: { timeLimit: 90, scoreWeight: 5 },
} as const

/** 生成 60 条合法词条（id = sqlite:1..60，词面测试词001..060，避免规范化后重复）。 */
function buildWords(count = MIN_SELECTED_WORD_COUNT): VocabularyWord[] {
  const words: VocabularyWord[] = []
  for (let index = 1; index <= count; index += 1) {
    const difficulty = 1 + ((index - 1) % 5)
    words.push({
      id: `sqlite:${index}`,
      text: `测试词${String(index).padStart(3, '0')}`,
      aliases: [],
      // (index-1) % 数组长度 ∈ {0,1,2} 恒非 undefined；noUncheckedIndexedAccess 下用非空断言
      category: CATEGORIES[(index - 1) % CATEGORIES.length]!,
      difficulty,
      // 可绘制性 1~5 轮换；hint 非空供结构化提示链路测试
      drawability: difficulty,
      hint: `提示${String(index).padStart(3, '0')}`,
      // 时限/权重按难度从测试 level_config 派生（同 Provider 加载期语义）
      timeLimit: TEST_LEVEL_CONFIG[difficulty as 1 | 2 | 3 | 4 | 5].timeLimit,
      scoreWeight: TEST_LEVEL_CONFIG[difficulty as 1 | 2 | 3 | 4 | 5].scoreWeight,
    })
  }
  return words
}

const MIN_SELECTED_WORD_COUNT = 60

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
      categoryEnum: [...CATEGORIES],
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
