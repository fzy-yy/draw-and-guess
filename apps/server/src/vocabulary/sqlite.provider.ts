/**
 * SQLite 词库 Provider（当前默认实现）。
 *
 * 职责链：定位并读取词库数据库 → 读取 metadata 构造白名单与缺省值 →
 * 读 words 表逐词条严格校验（category ⊆ category_enum、难度在合法区间、别称合法）→
 * 规范化（ID 生成 / enabled 过滤 / 去重）→ 内容哈希版本号。
 * 任何异常数据都以带中文文案的 Error 阻止启动，绝不带病运行。
 *
 * 库表结构（见 vocabulary/draw_guess_words.db）：
 * - metadata(id, meta_data_key, meta_data_value)：版本、更新时间、各枚举集合与缺省值；
 * - words(id, text, category, difficulty, enabled, time_limit, score_weight, aliases)
 *   —— 单词条只有一个分类（category），它同时是作画阶段的猜词提示；
 *     别称以 JSON 数组文本存储；enabled 为 0/1（1=进入候选池）。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { APP_CONFIG } from '../../../../config/index.ts'
import { serverStrings } from '../../../../string/index.ts'
import type { VocabularyWord } from '@draw-guess/shared'
import type { LoadedVocabulary, VocabularyProvider } from './contract.ts'
import { assertNoDuplicateText, canonicalWordId, hashWords } from './normalize.ts'

/** 元数据行：key/value 均为文本，枚举集合以 JSON 数组文本存储。 */
interface MetadataRow {
  meta_data_key: string
  meta_data_value: string
}

/** words 表行：与库表列一一对应；aliases 是 JSON 数组文本。 */
interface WordRow {
  id: number
  text: string
  category: string
  difficulty: number
  enabled: number
  time_limit: number
  score_weight: number
  aliases: string
}

/** 项目根目录：由 Provider 文件位置上溯（apps/server/src/vocabulary/../../../..）。 */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

/** SQLite 词库 Provider 实现（只读打开词库库文件，不干预游戏持久化库）。 */
export class SqliteProvider implements VocabularyProvider {
  readonly sourceId = 'sqlite'

  constructor(private readonly dbPath: string) {}

  async load(): Promise<LoadedVocabulary> {
    const resolved = this.resolveDbPath()
    // 只读打开：词库对服务端是只读资产；fileMustExist 让缺失在打开时即暴露。
    const database = new Database(resolved, { readonly: true, fileMustExist: true })
    try {
      const meta = this.readMeta(database)
      const categorySet = new Set(meta.categoryEnum)
      const usedIds = new Set<number>()
      const parsedWords: VocabularyWord[] = []

      const rows = database
        .prepare(
          'SELECT id, text, category, difficulty, enabled, time_limit, score_weight, aliases FROM words',
        )
        .all() as WordRow[]

      for (const row of rows) {
        // enabled=0（false）的词条直接跳过：不进入候选池，也不参与去重与版本哈希
        if (row.enabled !== 1) continue
        const aliases = this.parseAliases(row)
        this.assertWordShape(row, aliases, categorySet, usedIds)
        parsedWords.push({
          id: canonicalWordId(this.sourceId, row.id),
          text: row.text,
          aliases,
          category: row.category,
          difficulty: row.difficulty,
          // 库表为每个词条提供了 time_limit/score_weight；保留可选语义：缺省时回退词库默认值
          timeLimit: row.time_limit ?? meta.defaultTimeLimit,
          scoreWeight: row.score_weight ?? meta.defaultScoreWeight,
        })
      }

      if (parsedWords.length < APP_CONFIG.vocabulary.minWords) {
        throw new Error(
          serverStrings.vocabulary.tooFewWords(parsedWords.length, APP_CONFIG.vocabulary.minWords),
        )
      }
      if (parsedWords.length > APP_CONFIG.vocabulary.maxWords) {
        throw new Error(
          serverStrings.vocabulary.tooManyWords(parsedWords.length, APP_CONFIG.vocabulary.maxWords),
        )
      }
      if (APP_CONFIG.vocabulary.deduplicate) assertNoDuplicateText(parsedWords)

      return {
        words: parsedWords,
        version: hashWords(parsedWords),
        meta: {
          sourceId: this.sourceId,
          fileVersion: meta.version,
          updatedAt: meta.updatedAt,
          categoryEnum: meta.categoryEnum,
          defaultTimeLimit: meta.defaultTimeLimit,
          defaultScoreWeight: meta.defaultScoreWeight,
        },
      }
    } finally {
      database.close()
    }
  }

  /** 读取元数据表：枚举集合解析为字符串数组，缺省值解析为整数；缺失值以缺省串联处理。 */
  private readMeta(database: Database.Database): {
    version?: string
    updatedAt?: string
    categoryEnum: string[]
    defaultTimeLimit: number
    defaultScoreWeight: number
  } {
    const rows = database
      .prepare('SELECT meta_data_key, meta_data_value FROM metadata')
      .all() as MetadataRow[]
    const map = new Map(rows.map((row) => [row.meta_data_key, row.meta_data_value]))
    const parseList = (key: string): string[] => {
      const raw = map.get(key)
      if (!raw) return []
      try {
        const value: unknown = JSON.parse(raw)
        return Array.isArray(value) ? value.map(String).filter(Boolean) : []
      } catch {
        return []
      }
    }
    return {
      version: map.get('version'),
      updatedAt: map.get('updated_at'),
      categoryEnum: parseList('category_enum'),
      defaultTimeLimit: Number(map.get('default_time_limit')) || 0,
      defaultScoreWeight: Number(map.get('default_score_weight')) || 0,
    }
  }

  /** 单条词条的形状交叉校验：分类 ∈ category_enum、难度在配置区间、词面与别称长度/数量合法、主键不重复。 */
  private assertWordShape(
    row: WordRow,
    aliases: string[],
    categorySet: Set<string>,
    usedIds: Set<number>,
  ): void {
    if (usedIds.has(row.id)) {
      throw new Error(`词库存在重复主键：「${row.id}」，请修正词库数据。`)
    }
    usedIds.add(row.id)
    if (!categorySet.has(row.category)) {
      throw new Error(`词条「${row.text}」的分类「${row.category}」不在 category_enum 白名单内`)
    }
    const { min, max } = APP_CONFIG.vocabulary.difficultyRange
    if (!Number.isInteger(row.difficulty) || row.difficulty < min || row.difficulty > max) {
      throw new Error(
        `词条「${row.text}」的难度「${row.difficulty}」不在合法区间（${min}~${max}）内`,
      )
    }
    const length = Array.from(row.text).length
    if (length < 1 || length > APP_CONFIG.vocabulary.maxWordLength) {
      throw new Error(
        `词条「${row.text}」的长度「${length}」超出允许范围（1~${APP_CONFIG.vocabulary.maxWordLength}）`,
      )
    }
    if (aliases.length > APP_CONFIG.vocabulary.maxAliasesPerWord) {
      throw new Error(
        `词条「${row.text}」的别称数超过上限（${APP_CONFIG.vocabulary.maxAliasesPerWord}）`,
      )
    }
  }

  /** 解析别称 JSON：非法 JSON 视为异常数据；同时校验收紧后的每条别称长度与空白。 */
  private parseAliases(row: WordRow): string[] {
    let aliases: unknown
    try {
      aliases = JSON.parse(row.aliases || '[]')
    } catch {
      throw new Error(`词条「${row.text}」的别称不是合法 JSON，请修正词库数据。`)
    }
    if (!Array.isArray(aliases)) {
      throw new Error(`词条「${row.text}」的别称必须是数组，请修正词库数据。`)
    }
    const max = APP_CONFIG.vocabulary.maxAliasLength
    return aliases.map((alias) => {
      if (typeof alias !== 'string') {
        throw new Error(`词条「${row.text}」的别称含非字符串项，请修正词库数据。`)
      }
      const trimmed = alias.trim()
      const aliasLength = Array.from(trimmed).length
      if (aliasLength < 1 || aliasLength > max) {
        throw new Error(`词条「${row.text}」的别称「${alias}」长度超出允许范围（1~${max}）`)
      }
      return trimmed
    })
  }

  /** 定位数据库文件：优先项目根目录，其次进程工作目录（兼容根级与 workspace filter 启动）。 */
  private resolveDbPath(): string {
    const candidates = [
      path.resolve(PROJECT_ROOT, this.dbPath),
      path.resolve(process.cwd(), this.dbPath),
      path.resolve(process.cwd(), '../..', this.dbPath),
    ]
    const found = candidates.find((candidate) => existsSync(candidate))
    if (found) return found
    throw new Error(`词库数据库不存在：${this.dbPath}（已尝试：${candidates.join('、')}）`)
  }
}
