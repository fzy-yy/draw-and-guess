/**
 * 测试词面数据源（轻量纯模块，不依赖 better-sqlite3）。
 *
 * 两条 fixture 输出管道共用这一份词面知识，避免同构循环各写一份、
 * 改 MIN_SELECTED_VOCABULARY_WORDS 或词面规则时静默漂移：
 * - apps/server/src/vocabulary/test-fixture.ts → SQLite 库文件（E2E）；
 * - test/unit/helpers/mini-vocabulary.ts → 内存 VocabularyRegistry（单测）。
 * 单独成模块（而非放 test-fixture 里）是为了让纯逻辑单测不背原生依赖加载。
 */
/** 单测与夹具默认生成的测试词数。 */
export const DEFAULT_TEST_WORD_COUNT = 60

/** 测试词库合集轮转表（与 SqliteProvider/快照的合集聚合对齐）。 */
export const TEST_WORD_COLLECTIONS = ['物品', '动物', '动作'] as const

/** 一条测试词面规格：编号/词面/合集（难度/可绘制性/提示已随词库瘦身移除）。 */
interface TestWordSpec {
  index: number
  text: string
  collection: string
}

/**
 * 生成词面规格：词面唯一（padStart 编号）；分类三值轮转（覆盖分类白名单与候选多样性）。
 * 默认条数即协议裁决线 MIN_SELECTED_VOCABULARY_WORDS——少于它 startGame 会拒绝开局。
 */
export function buildWordSpecs(count = DEFAULT_TEST_WORD_COUNT): TestWordSpec[] {
  const specs: TestWordSpec[] = []
  for (let index = 1; index <= count; index += 1) {
    specs.push({
      index,
      text: `测试词${String(index).padStart(3, '0')}`,
      collection: TEST_WORD_COLLECTIONS[(index - 1) % TEST_WORD_COLLECTIONS.length] ?? '物品',
    })
  }
  return specs
}
