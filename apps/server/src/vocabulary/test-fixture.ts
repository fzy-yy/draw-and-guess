/**
 * 隔离测试用词库 fixture 生成器。
 *
 * 供 E2E launcher 在「唯一临时目录」内生成最小但**可开完整局**的词库 SQLite 库文件：
 * - 包 ID 取数据库文件名，名称/描述/版本等元数据可按测试场景注入；
 * - 词条数 ≥ MIN_SELECTED_VOCABULARY_WORDS（协议常量裁决线），否则 startGame 会因词条不足而拒绝；
 * - 表结构与重建后的正式词库一致（metadata 含 level_config/difficulty_enum/drawability_enum，
 *   words 含 drawability/hint/updated_at），通过 SqliteProvider 的严格校验。
 *
 * 只写入调用方给定的临时路径，绝不触碰仓库真实 vocabulary/*.db。
 * 放在 apps/server/src 内是让 better-sqlite3 能按 pnpm 严格 node_modules 解析到（而非 test/ 目录）。
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { MIN_SELECTED_VOCABULARY_WORDS } from '@draw-guess/shared'
import { APP_CONFIG } from '../config/index.ts'
import { buildWordSpecs } from './test-word-specs.ts'

/**
 * E2E 词条时限（秒）：远大于产品默认 90s。
 * 09 容量用例要在同一回合内用**真实点击**推满 maxHistoryCommands=1500 条命令，
 * 而 CI runner 的点击吞吐远低于本地，90s 窗口会在推满前到期（main 长期红的原因）。
 * 只影响 e2e fixture，不进生产词库。
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

    // 难度/可绘制性白名单与 level_config：与 SqliteProvider 的完整性校验对齐
    const { min: diffMin, max: diffMax } = APP_CONFIG.vocabulary.difficultyRange
    const difficultyEnum = Array.from(
      { length: diffMax - diffMin + 1 },
      (_item, index) => diffMin + index,
    )
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
    // 词面来自共享数据源（与内存 fixture 单源）；难度仍按配置的 difficulty_enum 取模
    // （保持「测试时限/难度服从 APP_CONFIG」的原行为，配置枚举变化时不越白名单）。
    for (const spec of buildWordSpecs(wordCount)) {
      const difficulty = difficultyEnum[(spec.index - 1) % difficultyEnum.length] ?? spec.difficulty
      insertWord.run(
        spec.index,
        spec.text,
        spec.category,
        difficulty,
        // 可绘制性在 1~5 内轮换，覆盖星级展示的各档位
        spec.drawability,
        '[]',
        // 提示文案与正式词库同款形态（≤10 字），词库 Provider 仍会解析并校验该列
        spec.hint,
      )
    }
  } finally {
    db.close()
  }
}
