/**
 * SQLite 词库 Provider（当前默认实现）。
 *
 * 职责链：定位并读取词库数据库 → 读取 metadata 构造分类白名单 →
 * 读 words 表逐词条严格校验（category ⊆ category_enum、词面长度、别称合法、主键不重复）→
 * 规范化（ID 生成 / enabled 过滤 / 去重）→ 内容哈希版本号。
 * 任何异常数据都以带中文文案的 Error 阻止启动，绝不带病运行。
 *
 * 库表结构（词库重建版，见 vocabulary/base_words.db）：
 * - metadata(meta_data_key PRIMARY KEY, meta_data_value)：版本、更新时间与分类枚举集合
 *  （数组统一存 JSON 文本）；
 * - words(id, text, category, enabled, aliases, updated_at)——单词条只有一个分类（category）；
 *   别称以 JSON 数组文本存储；enabled 为 0/1（1=进入候选池）。
 *
 * 难度、可绘制性、提示与难度级时限/权重已随词库瘦身退出领域模型：旧词库文件里若仍残留这些列，
 * 本 Provider 既不读取也不校验（代码先不依赖、数据后删列，见
 * docs/adr/0046-vocabulary-slimming-and-unified-round-time.md）。
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

/** words 表行：只取领域模型需要的列；遗留列（难度/可绘制性/提示等）完全不读。 */
interface WordRow {
  id: number
  text: string
  category: string
  enabled: number
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
      const categorySet = new Set(meta.categoryEnum)
      const usedIds = new Set<number>()
      const parsedWords: VocabularyWord[] = []

      // 哈希版本号按数组顺序逐词拼接：SQL 不保证行序（VACUUM 重写文件、查询计划变化都会改序），
      // 必须显式 ORDER BY id，才能保证「内容不变则版本号不变」的确定性。
      const rows = database
        .prepare(
          `SELECT id, text, category, enabled, aliases
           FROM words
           ORDER BY id`,
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
          categoryEnum: meta.categoryEnum,
          wordCount: parsedWords.length,
        },
      }
    } finally {
      database.close()
    }
  }

  /** 读取元数据表：分类枚举解析为数组；任何缺失/畸形都以中文错误阻止启动。 */
  private readMeta(database: Database.Database): {
    name?: string
    description?: string
    version?: string
    updatedAt?: string
    categoryEnum: string[]
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
    // 必填非空白名单：category_enum 缺失/畸形时若静默返回空集，逐词校验会把错误指向
    // 词条本身（「分类不在白名单内」）而非元数据，排查方向被误导；这里直接点名元数据键 fail-fast。
    const parseRequiredList = (key: string): string[] => {
      const list = parseList(key)
      if (list.length === 0) {
        throw new Error(`词库元数据缺少合法的 ${key}（应为非空 JSON 数组），请修正词库数据。`)
      }
      return list
    }
    return {
      name: map.get('name')?.trim(),
      description: map.get('description')?.trim(),
      version: map.get('version'),
      updatedAt: map.get('updated_at'),
      categoryEnum: parseRequiredList('category_enum'),
    }
  }

  /**
   * 单条词条的形状交叉校验：分类 ∈ category_enum、词面与别称长度合法、主键不重复。
   */
  private assertWordShape(
    row: WordRow,
    aliases: string[],
    categorySet: Set<string>,
    usedIds: Set<number>,
  ): void {
    // 重复主键检查：正式库与测试 fixture 的 words.id 都是 INTEGER PRIMARY KEY，重复本不可能出现；
    // 保留此检查是为将来「未声明主键的自定义词库」兜底（Provider 是异常数据的最后防线）。
    if (usedIds.has(row.id)) {
      throw new Error(`词库存在重复主键：「${row.id}」，请修正词库数据。`)
    }
    usedIds.add(row.id)
    if (!categorySet.has(row.category)) {
      throw new Error(`词条「${row.text}」的分类「${row.category}」不在 category_enum 白名单内`)
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
