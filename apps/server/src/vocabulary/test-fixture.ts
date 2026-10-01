/**
 * 隔离测试用词库 fixture 生成器。
 *
 * 供 E2E launcher 在「唯一临时目录」内生成最小但**可开完整局**的词库 SQLite 库文件：
 * - 包 ID 取数据库文件名，名称/描述/版本等元数据可按测试场景注入；
 * - 词条数 ≥ MIN_SELECTED_VOCABULARY_WORDS（协议常量裁决线），否则 startGame 会因词条不足而拒绝；
 * - 表结构保留词库重建版的遗留列（difficulty/drawability/hint/level_config 等），
 *   用于覆盖「旧词库文件带多余列时 Provider 照常加载」的兼容路径。
 *
 * 只写入调用方给定的临时路径，绝不触碰仓库真实 vocabulary/*.db。
 * 放在 apps/server/src 内是让 better-sqlite3 能按 pnpm 严格 node_modules 解析到（而非 test/ 目录）。
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { MIN_SELECTED_VOCABULARY_WORDS } from '@draw-guess/shared'
import { buildWordSpecs } from './test-word-specs.ts'

/**
 * 遗留 level_config 的 time_limit 取值（秒）：单回合时长已改由房间规则决定，该列不再被读取，
 * 仅作为「旧词库带多余列」的夹具数据保留。容量用例的回合窗口现由房间规则指定。
 */
const E2E_WORD_TIME_LIMIT_SECONDS = 600

export interface MinimalVocabularyFixtureOptions {
  wordCount?: number
  name?: string
  description?: string
  version?: string
  updatedAt?: string
}

/** 生成一份词库数据库文件到 filePath（若目录不存在则创建）。 */
export function createMinimalVocabularyDb(
  filePath: string,
  options: MinimalVocabularyFixtureOptions = {},
): void {
  const {
    wordCount = MIN_SELECTED_VOCABULARY_WORDS,
    name = path.basename(filePath, '.db'),
    description = 'E2E 隔离环境自动生成的最小词库',
    version = '1.0.0',
    updatedAt = '2026-01-01T00:00:00.000Z',
  } = options
  mkdirSync(path.dirname(filePath), { recursive: true })
  const db = new Database(filePath)
  try {
    db.exec(`
      CREATE TABLE metadata(
        meta_data_key TEXT PRIMARY KEY,
        meta_data_value TEXT NOT NULL
      );
      CREATE TABLE words(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        difficulty INTEGER NOT NULL,
        drawability INTEGER NOT NULL DEFAULT 3,
        enabled INTEGER NOT NULL DEFAULT 1,
        aliases TEXT NOT NULL DEFAULT '[]',
        hint TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `)

    // 词库瘦身后难度/可绘制性/level_config 已退出领域模型；夹具仍写出这些遗留列与元数据键，
    // 用于覆盖「旧词库文件带多余列时 Provider 照常加载」的兼容路径。
    const difficultyEnum = [1, 2, 3, 4, 5]
    const levelConfig: Record<string, { time_limit: number; score_weight: number }> = {}
    for (const level of difficultyEnum) {
      levelConfig[String(level)] = {
        time_limit: E2E_WORD_TIME_LIMIT_SECONDS,
        // 计分已改为固定 100 分制，词条权重不再参与计算；夹具保留该列只为覆盖
        // 「旧词库仍带多余列」的兼容路径（列本身由词库重建另行删除）。
        score_weight: 5,
      }
    }

    const metaRows: Array<[string, string]> = [
      ['name', name],
      ['description', description],
      ['version', version],
      ['updated_at', updatedAt],
      ['category_enum', JSON.stringify(['物品', '动物', '动作'])],
      ['difficulty_enum', JSON.stringify(difficultyEnum)],
      ['drawability_enum', JSON.stringify([1, 2, 3, 4, 5])],
      ['enabled_enum', JSON.stringify([0, 1])],
      ['level_config', JSON.stringify(levelConfig)],
    ]
    const insertMeta = db.prepare(
      'INSERT INTO metadata(meta_data_key, meta_data_value) VALUES(?, ?)',
    )
    for (const [key, value] of metaRows) insertMeta.run(key, value)

    const insertWord = db.prepare(
      `INSERT INTO words(id, text, category, difficulty, drawability, enabled, aliases, hint, updated_at)
       VALUES(?, ?, ?, ?, ?, 1, ?, ?, '')`,
    )
    // 词面/分类来自共享数据源（与内存 fixture 单源）；难度/可绘制性/提示只是旧词库的遗留列，
    // Provider 已不再读取，这里照写是为了让 e2e 覆盖「旧词库带多余列」的兼容路径。
    for (const spec of buildWordSpecs(wordCount)) {
      insertWord.run(
        spec.index,
        spec.text,
        spec.category,
        difficultyEnum[(spec.index - 1) % difficultyEnum.length] ?? 1,
        ((spec.index - 1) % 5) + 1,
        '[]',
        '',
      )
    }
  } finally {
    db.close()
  }
}
