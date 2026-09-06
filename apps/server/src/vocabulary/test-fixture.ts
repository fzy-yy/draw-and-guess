/**
 * 隔离测试用词库 fixture 生成器。
 *
 * 供 E2E launcher 在「唯一临时目录」内生成最小但**可开完整局**的词库 SQLite 库文件：
 * - 包 ID 取数据库文件名，名称/描述/版本等元数据可按测试场景注入；
 * - 词条数 ≥ MIN_SELECTED_VOCABULARY_WORDS(60)，否则 startGame 会因词条不足而拒绝；
 * - 字段与当前多词库格式兼容（metadata + words），通过 SqliteProvider 的严格校验。
 *
 * 只写入调用方给定的临时路径，绝不触碰仓库真实 vocabulary/*.db。
 * 放在 apps/server/src 内是让 better-sqlite3 能按 pnpm 严格 node_modules 解析到（而非 test/ 目录）。
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { APP_CONFIG } from '../../../../config/index.ts'

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
    wordCount = 60,
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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meta_data_key TEXT,
        meta_data_value TEXT
      );
      CREATE TABLE words(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT,
        category TEXT,
        difficulty INTEGER,
        enabled INTEGER,
        time_limit INTEGER,
        score_weight INTEGER,
        aliases TEXT
      );
    `)

    const metaRows: Array<[string, string]> = [
      ['name', name],
      ['description', description],
      ['version', version],
      ['updated_at', updatedAt],
      ['category_enum', JSON.stringify(['物品', '动物', '动作'])],
      ['default_time_limit', String(APP_CONFIG.game.drawSeconds.default)],
      ['default_score_weight', String(APP_CONFIG.game.score.defaultWordWeight)],
    ]
    const insertMeta = db.prepare(
      'INSERT INTO metadata(meta_data_key, meta_data_value) VALUES(?, ?)',
    )
    for (const [key, value] of metaRows) insertMeta.run(key, value)

    const insertWord = db.prepare(
      `INSERT INTO words(id, text, category, difficulty, enabled, time_limit, score_weight, aliases)
       VALUES(?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    const categories = ['物品', '动物', '动作']
    const diffRange = APP_CONFIG.vocabulary.difficultyRange
    for (let index = 1; index <= wordCount; index += 1) {
      const difficulty = diffRange.min + ((index - 1) % (diffRange.max - diffRange.min + 1))
      insertWord.run(
        index,
        `测试词${String(index).padStart(3, '0')}`,
        categories[(index - 1) % categories.length],
        difficulty,
        APP_CONFIG.game.drawSeconds.default,
        APP_CONFIG.game.score.guessBase / 60,
        '[]',
      )
    }
  } finally {
    db.close()
  }
}
