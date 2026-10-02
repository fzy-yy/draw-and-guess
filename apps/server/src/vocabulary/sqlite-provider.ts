/**
 * SQLite 词库 Provider（当前默认实现）。
 *
 * 职责链：定位并读取词库数据库 → 读 words 表逐词条严格校验（collection 非空、词面长度、别称合法、主键不重复）→
 * 自动检测并聚合全部合集（collections）→ 规范化（ID 生成 / 去重）→ 内容哈希版本号。
 * 任何异常数据都以带中文文案的 Error 阻止启动，绝不带病运行。
 *
 * 库表结构（见 vocabulary/base_words.db）：
 * - metadata(meta_data_key PRIMARY KEY, meta_data_value)：版本、更新时间等键值对；
 * - words(id, text, collection, aliases)——单词条归属一个合集（collection）；
 *   别称以 JSON 数组文本存储。
 *
 * 难度、可绘制性、提示、是否启用与 category_enum 白名单已移除（见 docs/adr/0046、0048、0053）；
 * 本 Provider 对旧词库文件的 category 列自动降级读取映射。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { APP_CONFIG } from '../config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import type { VocabularyWord } from '@draw-guess/shared'
import type { LoadedVocabulary, VocabularyProvider } from './contract.ts'
import { assertNoDuplicateText, canonicalWordId, hashWords } from './normalize.ts'

/** 元数据行：key/value 均为文本，枚举集合与映射对象以 JSON 文本存储。 */
interface MetadataRow {
  meta_data_key: string
  meta_data_value: string
}

/** words 表行：只取领域模型需要的列；遗留列（难度/可绘制性/提示/启用位等）完全不读。 */
interface WordRow {
  id: number
  text: string
  collection?: string
  category?: string
  aliases: string
}

/** 项目根目录：由 Provider 文件位置上溯（apps/server/src/vocabulary/../../../..）。 */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

/** SQLite 词库 Provider 实现（只读打开词库库文件，不干预游戏持久化库）。 */
export class SqliteProvider implements VocabularyProvider {
  readonly sourceId = 'sqlite'

  constructor(private readonly dbPath: string) {}

  // better-sqlite3 是同步 API，本方法体内没有可 await 的异步操作；保留 async 是为满足
  // VocabularyProvider.load(): Promise 接口并把同步抛错规整为 rejection（调用方统一 await 捕获）。
  // 属 require-await 的已知接口适配误报，定点豁免。
  // eslint-disable-next-line @typescript-eslint/require-await
  async load(): Promise<LoadedVocabulary> {
    const resolved = this.resolveDbPath()
    // 只读打开：词库对服务端是只读资产；fileMustExist 让缺失在打开时即暴露。
    const database = new Database(resolved, { readonly: true, fileMustExist: true })
    try {
      const meta = this.readMeta(database)
      const usedIds = new Set<number>()
      const parsedWords: VocabularyWord[] = []
      const collectionsSet = new Set<string>()

      // 检查 words 表结构以兼容 collection 与遗留 category 列
      const columns = database.prepare('PRAGMA table_info(words)').all() as Array<{ name: string }>
      const hasCollection = columns.some((col) => col.name === 'collection')
      const selectSql = hasCollection
        ? `SELECT id, text, collection, aliases FROM words ORDER BY id`
        : `SELECT id, text, category AS collection, aliases FROM words ORDER BY id`
      const rows = database.prepare(selectSql).all() as Array<{
        id: number
        text: string
        collection: string
        aliases: string
      }>

      for (const row of rows) {
        const aliases = this.parseAliases(row)
        this.assertWordShape(row, aliases, usedIds)
        const collection = row.collection.trim()
        collectionsSet.add(collection)
        parsedWords.push({
          id: canonicalWordId(this.sourceId, row.id),
          text: row.text,
          aliases,
          collection,
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

      const baseId = path.basename(this.dbPath, '.db')
      return {
        words: parsedWords,
        version: hashWords(parsedWords),
        meta: {
          sourceId: this.sourceId,
          id: baseId,
          name: meta.name || baseId,
          description: meta.description || '',
          fileVersion: meta.version,
          updatedAt: meta.updatedAt,
          collections: Array.from(collectionsSet),
          wordCount: parsedWords.length,
        },
      }
    } finally {
      database.close()
    }
  }

  /** 读取元数据表：仅保留 name / description / version / updated_at。 */
  private readMeta(database: Database.Database): {
    name?: string
    description?: string
    version?: string
    updatedAt?: string
  } {
    const rows = database
      .prepare('SELECT meta_data_key, meta_data_value FROM metadata')
      .all() as MetadataRow[]
    const map = new Map(rows.map((row) => [row.meta_data_key, row.meta_data_value]))
    return {
      name: map.get('name')?.trim(),
      description: map.get('description')?.trim(),
      version: map.get('version'),
      updatedAt: map.get('updated_at'),
    }
  }

  /**
   * 单条词条的形状校验：合集非空、词面与别称长度合法、主键不重复。
   */
  private assertWordShape(
    row: { id: number; text: string; collection: string },
    aliases: string[],
    usedIds: Set<number>,
  ): void {
    if (usedIds.has(row.id)) {
      throw new Error(`词库存在重复主键：「${row.id}」，请修正词库数据。`)
    }
    usedIds.add(row.id)
    if (!row.collection || !row.collection.trim()) {
      throw new Error(`词条「${row.text}」的合集（collection）不能为空，请修正词库数据。`)
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
