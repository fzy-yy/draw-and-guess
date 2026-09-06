/**
 * 内存词库注册表（单元测试用）。
 *
 * 与 apps/server/src/vocabulary/test-fixture.ts 生成的最小词库同构：词条数 ≥ MIN_SELECTED_VOCABULARY_WORDS(60)，
 * 字段符合 VocabularyWord（id/text/aliases/category/difficulty/timeLimit/scoreWeight），
 * category 属于 category_enum 白名单，difficulty 落在合法区间。
 * 提供一个符合 VocabularyRegistry 接口的内存对象，让 GameService 在不开 SQLite、不读真实词库的前提下运转。
 */
import type { VocabularyWord } from '@draw-guess/shared'
import type { VocabularyRegistry } from '../../../apps/server/src/vocabulary/index.ts'

const CATEGORIES = ['物品', '动物', '动作'] as const

/** 生成 60 条合法词条（id = sqlite:1..60，词面测试词001..060，避免规范化后重复）。 */
function buildWords(count = MIN_SELECTED_WORD_COUNT): VocabularyWord[] {
  const words: VocabularyWord[] = []
  for (let index = 1; index <= count; index += 1) {
    words.push({
      id: `sqlite:${index}`,
      text: `测试词${String(index).padStart(3, '0')}`,
      aliases: [],
      // (index-1) % 数组长度 ∈ {0,1,2} 恒非 undefined；noUncheckedIndexedAccess 下用非空断言
      category: CATEGORIES[(index - 1) % CATEGORIES.length]!,
      difficulty: 1 + ((index - 1) % 5),
      timeLimit: 90,
      scoreWeight: 5,
    })
  }
  return words
}

const MIN_SELECTED_WORD_COUNT = 60

/** 构建内存 VocabularyRegistry（单一词库包，id 命名为 draw_guess_words 以贴合现有快照与 UI 约定）。 */
export function createMemoryVocabularyRegistry(): VocabularyRegistry {
  const packageId = 'draw_guess_words'
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
      defaultTimeLimit: 90,
      defaultScoreWeight: 5,
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
