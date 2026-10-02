/**
 * 隔离测试用词库 fixture 生成器。
 *
 * 供 E2E launcher 在「唯一临时目录」内生成最小但**可开完整局**的词库 SQLite 库文件：
 * - 包 ID 取数据库文件名，名称/描述/版本等元数据可按测试场景注入；
 * - 词条数 ≥ MIN_SELECTED_VOCABULARY_WORDS（协议常量裁决线），否则 startGame 会因词条不足而拒绝；
 * - 表结构为当前精简口径：words 只含词面/分类/别称，metadata 只含 name/description/version/updated_at/category_enum。
 *
 * 只写入调用方给定的临时路径，绝不触碰仓库真实 vocabulary/*.db。
 * 放在 apps/server/src 内是让 better-sqlite3 能按 pnpm 严格 node_modules 解析到（而非 test/ 目录）。
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { MIN_SELECTED_VOCABULARY_WORDS } from '@draw-guess/shared'
import { buildWordSpecs } from './test-word-specs.ts'

interface MinimalVocabularyFixtureOptions {
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
        collection TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]'
      );
    `)

    const metaRows: Array<[string, string]> = [
      ['name', name],
      ['description', description],
      ['version', version],
      ['updated_at', updatedAt],
    ]
    const insertMeta = db.prepare(
      'INSERT INTO metadata(meta_data_key, meta_data_value) VALUES(?, ?)',
    )
    for (const [key, value] of metaRows) insertMeta.run(key, value)

    const insertWord = db.prepare(
      'INSERT INTO words(id, text, collection, aliases) VALUES(?, ?, ?, ?)',
    )
    for (const spec of buildWordSpecs(wordCount)) {
      insertWord.run(spec.index, spec.text, spec.collection, '[]')
    }
  } finally {
    db.close()
  }
}
