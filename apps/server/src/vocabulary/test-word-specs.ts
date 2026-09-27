/**
 * 测试词面数据源（轻量纯模块，不依赖 better-sqlite3）。
 *
 * 两条 fixture 输出管道共用这一份词面知识，避免同构循环各写一份、
 * 改 MIN_SELECTED_VOCABULARY_WORDS 或词面规则时静默漂移：
 * - apps/server/src/vocabulary/test-fixture.ts → SQLite 库文件（E2E）；
 * - test/unit/helpers/mini-vocabulary.ts → 内存 VocabularyRegistry（单测）。
 * 单独成模块（而非放 test-fixture 里）是为了让纯逻辑单测不背原生依赖加载。
 */
import { MIN_SELECTED_VOCABULARY_WORDS } from '@draw-guess/shared'

/** 测试词库分类轮转表（与 SqliteProvider/快照的分类白名单校验对齐）。 */
export const TEST_WORD_CATEGORIES = ['物品', '动物', '动作'] as const

/** 一条测试词面规格：编号/词面/分类/难度/可绘制性/提示。 */
export interface TestWordSpec {
  index: number
  text: string
  category: string
  difficulty: number
  drawability: number
  hint: string
}

/**
 * 生成词面规格：词面唯一（padStart 编号）；难度/可绘制性按 1~5 轮换（覆盖两管道的
 * 难度/可绘制性枚举白名单与星级展示档位）；分类三值轮转；hint ≤10 字贴合正式词库形态。
 * 默认条数即协议裁决线 MIN_SELECTED_VOCABULARY_WORDS——少于它 startGame 会拒绝开局。
 */
export function buildWordSpecs(count = MIN_SELECTED_VOCABULARY_WORDS): TestWordSpec[] {
  const specs: TestWordSpec[] = []
  for (let index = 1; index <= count; index += 1) {
    const rotation = (index - 1) % 5
    specs.push({
      index,
      text: `测试词${String(index).padStart(3, '0')}`,
      category: TEST_WORD_CATEGORIES[(index - 1) % TEST_WORD_CATEGORIES.length] ?? '物品',
      difficulty: rotation + 1,
      drawability: rotation + 1,
      hint: `提示${String(index).padStart(3, '0')}`,
    })
  }
  return specs
}
