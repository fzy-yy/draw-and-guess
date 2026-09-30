/**
 * SQLite 词库 Provider（当前默认实现）。
 *
 * 职责链：定位并读取词库数据库 → 读取 metadata 构造白名单与难度分级配置 →
 * 读 words 表逐词条严格校验（category ⊆ category_enum、difficulty ⊆ difficulty_enum、
 * drawability ⊆ drawability_enum、hint 长度合法、别称合法）→
 * 规范化（ID 生成 / enabled 过滤 / 去重 / 按难度派生时限与权重）→ 内容哈希版本号。
 * 任何异常数据都以带中文文案的 Error 阻止启动，绝不带病运行。
 *
 * 库表结构（词库重建版，见 vocabulary/base_words.db）：
 * - metadata(meta_data_key PRIMARY KEY, meta_data_value)：版本、更新时间、各枚举集合与
 *   level_config（难度 → 时限/权重映射，数组与对象统一存 JSON 文本）；
 * - words(id, text, category, difficulty, drawability, enabled, aliases, hint, updated_at)
 *   —— 单词条只有一个分类（category）；可绘制性 drawability 为词库作者标注（1~5）；
 *     hint 为对局结构化提示文案（≤10 字，空串合法）；别称以 JSON 数组文本存储；
 *     enabled 为 0/1（1=进入候选池）；逐词 time_limit/score_weight 已废弃，
 *     由本 Provider 在加载期按 difficulty 查 level_config 派生到词条字段；
 *     逐词 updated_at 仅是词库作者的编辑时间，不进入运行时 DTO。
 *
 * 时限/权重「加载期解析」与提示揭示改版的取舍见 docs/adr/0013-vocabulary-level-config-and-hints.md。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { APP_CONFIG } from '../config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import type { VocabularyWord } from '@draw-guess/shared'
import type { LoadedVocabulary, VocabularyLevelConfig, VocabularyProvider } from './contract.ts'
import { assertNoDuplicateText, canonicalWordId, hashWords } from './normalize.ts'

/** 元数据行：key/value 均为文本，枚举集合与映射对象以 JSON 文本存储。 */
interface MetadataRow {
  meta_data_key: string
  meta_data_value: string
}

/** words 表行：与库表列一一对应；aliases 是 JSON 数组文本；updated_at 仅编辑时间、忽略。 */
interface WordRow {
  id: number
  text: string
  category: string
  difficulty: number
  drawability: number
  enabled: number
  aliases: string
  hint: string
  updated_at: string
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
      const difficultySet = new Set(meta.difficultyEnum)
      const drawabilitySet = new Set(meta.drawabilityEnum)
      const usedIds = new Set<number>()
      const parsedWords: VocabularyWord[] = []

      // 哈希版本号按数组顺序逐词拼接：SQL 不保证行序（VACUUM 重写文件、查询计划变化都会改序），
      // 必须显式 ORDER BY id，才能保证「内容不变则版本号不变」的确定性。
      const rows = database
        .prepare(
          `SELECT id, text, category, difficulty, drawability, enabled, aliases, hint, updated_at
           FROM words
           ORDER BY id`,
        )
        .all() as WordRow[]

      for (const row of rows) {
        // enabled=0（false）的词条直接跳过：不进入候选池，也不参与去重与版本哈希
        if (row.enabled !== 1) continue
        const aliases = this.parseAliases(row)
        const hint = this.parseHint(row)
        this.assertWordShape(row, aliases, categorySet, difficultySet, drawabilitySet, usedIds)
        // 难度级时限与权重加载期派生：readMeta 已保证 difficulty_enum 每级都有 level_config 条目；
        // 仍显式守卫一次（noUncheckedIndexedAccess 下索引带 undefined），脏数据 fail-fast 而非静默崩溃。
        const level = meta.levelConfig[row.difficulty]
        if (!level) {
          throw new Error(
            `词库词条「${row.text}」难度「${row.difficulty}」缺少 level_config，请修正词库数据。`,
          )
        }
        parsedWords.push({
          id: canonicalWordId(this.sourceId, row.id),
          text: row.text,
          aliases,
          category: row.category,
          difficulty: row.difficulty,
          drawability: row.drawability,
          hint,
          timeLimit: level.timeLimit,
          scoreWeight: level.scoreWeight,
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
          difficultyEnum: meta.difficultyEnum,
          drawabilityEnum: meta.drawabilityEnum,
          levelConfig: meta.levelConfig,
          wordCount: parsedWords.length,
        },
      }
    } finally {
      database.close()
    }
  }

  /** 读取元数据表：枚举集合解析为数组，level_config 解析为难度映射；任何缺失/畸形都以中文错误阻止启动。 */
  private readMeta(database: Database.Database): {
    name?: string
    description?: string
    version?: string
    updatedAt?: string
    categoryEnum: string[]
    difficultyEnum: number[]
    drawabilityEnum: number[]
    levelConfig: Record<number, VocabularyLevelConfig>
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
    const parseNumberList = (key: string): number[] => {
      const list = parseList(key)
        .map(Number)
        .filter((item) => Number.isInteger(item))
      if (list.length === 0) {
        throw new Error(`词库元数据缺少合法的 ${key}（应为非空整数 JSON 数组），请修正词库数据。`)
      }
      return list
    }
    const difficultyEnum = parseNumberList('difficulty_enum')
    // 双重白名单交叉校验：difficulty_enum 自身也必须落在配置区间内。若只在逐词校验时拦截，
    // 元数据把「6」写进枚举且 level_config 同步覆盖时整体能通过元数据校验，而难度 6 的词条
    // 会报「不在 difficulty_enum 白名单内」——错误指向词条，真正的病根（元数据）被掩盖。
    const { min, max } = APP_CONFIG.vocabulary.difficultyRange
    for (const level of difficultyEnum) {
      if (level < min || level > max) {
        throw new Error(
          `词库 difficulty_enum 含超出合法区间（${min}~${max}）的难度「${level}」，请修正词库数据。`,
        )
      }
    }
    const levelConfig = this.parseLevelConfig(map, difficultyEnum)
    return {
      name: map.get('name')?.trim(),
      description: map.get('description')?.trim(),
      version: map.get('version'),
      updatedAt: map.get('updated_at'),
      categoryEnum: parseRequiredList('category_enum'),
      // 三个白名单都是逐词校验与 level_config 完整性的基准，缺失即异常数据
      difficultyEnum,
      drawabilityEnum: parseNumberList('drawability_enum'),
      levelConfig,
    }
  }

  /**
   * 解析并校验 level_config（难度 → 时限/权重映射）：
   * - 必须是合法 JSON 对象，键为整数难度级；库内条目沿用库表 snake_case 命名
   *  （time_limit/score_weight），解析为契约层的 camelCase；
   * - 每条 time_limit 为正整数（秒）、score_weight 为正数；
   * - difficulty_enum 的每一级都必须有条目（缺失即拒绝启动），多余键同样视为异常数据
   *   （避免拼写错误的难度级静默失效，导致该难度词条无时限可派生）；
   * - 校验后 level_config 与 difficulty_enum 严格互相覆盖，下游按 difficulty 直接取用。
   */
  private parseLevelConfig(
    map: Map<string, string>,
    difficultyEnum: number[],
  ): Record<number, VocabularyLevelConfig> {
    const raw = map.get('level_config')
    if (!raw) {
      throw new Error('词库元数据缺少 level_config（难度级时限与权重映射），请修正词库数据。')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('词库的 level_config 不是合法 JSON，请修正词库数据。')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('词库的 level_config 必须是「难度 → 配置」对象，请修正词库数据。')
    }
    const levelConfig: Record<number, VocabularyLevelConfig> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const level = Number(key)
      if (!Number.isInteger(level) || !difficultyEnum.includes(level)) {
        throw new Error(
          `词库 level_config 存在不在 difficulty_enum 内的难度键「${key}」，请修正词库数据。`,
        )
      }
      // 库内命名是 snake_case；这里做一次性形状收窄，避免脏字段流向下游
      const entry = value as { time_limit?: unknown; score_weight?: unknown } | null
      const timeLimit = entry?.time_limit
      const scoreWeight = entry?.score_weight
      // typeof 守卫把 unknown 收窄为 number，无需再 `as number`；Number.isInteger/Finite 只做值域校验
      if (
        !entry ||
        typeof timeLimit !== 'number' ||
        !Number.isInteger(timeLimit) ||
        timeLimit < 1 ||
        typeof scoreWeight !== 'number' ||
        !Number.isFinite(scoreWeight) ||
        scoreWeight <= 0
      ) {
        throw new Error(
          `词库 level_config 难度「${key}」的条目不合法（time_limit 需为正整数秒、score_weight 需为正数），请修正词库数据。`,
        )
      }
      levelConfig[level] = { timeLimit, scoreWeight }
    }
    for (const level of difficultyEnum) {
      if (levelConfig[level] === undefined) {
        throw new Error(`词库 level_config 缺少难度「${level}」的时限/权重配置，请修正词库数据。`)
      }
    }
    return levelConfig
  }

  /**
   * 单条词条的形状交叉校验：分类 ∈ category_enum、难度 ∈ difficulty_enum ∩ 配置区间、
   * 可绘制性 ∈ drawability_enum、词面与别称/提示长度合法、主键不重复。
   */
  private assertWordShape(
    row: WordRow,
    aliases: string[],
    categorySet: Set<string>,
    difficultySet: Set<number>,
    drawabilitySet: Set<number>,
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
    const { min, max } = APP_CONFIG.vocabulary.difficultyRange
    if (!Number.isInteger(row.difficulty) || row.difficulty < min || row.difficulty > max) {
      throw new Error(
        `词条「${row.text}」的难度「${row.difficulty}」不在合法区间（${min}~${max}）内`,
      )
    }
    // 难度还必须在 difficulty_enum 内：readMeta 已保证每级都有 level_config 条目可供派生时限/权重
    if (!difficultySet.has(row.difficulty)) {
      throw new Error(`词条「${row.text}」的难度「${row.difficulty}」不在 difficulty_enum 白名单内`)
    }
    if (!drawabilitySet.has(row.drawability)) {
      throw new Error(
        `词条「${row.text}」的可绘制性「${row.drawability}」不在 drawability_enum 白名单内`,
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

  /**
   * 解析提示文案：trim 后必须是不超过 maxHintLength 的字符串（空串合法——该词条将回退
   * 揭示分类）。按 Array.from 计码点数，与词面长度口径一致，避免代理对被算成 2。
   */
  private parseHint(row: WordRow): string {
    if (typeof row.hint !== 'string') {
      throw new Error(`词条「${row.text}」的提示不是字符串，请修正词库数据。`)
    }
    const trimmed = row.hint.trim()
    const length = Array.from(trimmed).length
    if (length > APP_CONFIG.vocabulary.maxHintLength) {
      throw new Error(
        `词条「${row.text}」的提示「${trimmed}」长度「${length}」超过上限（${APP_CONFIG.vocabulary.maxHintLength}）`,
      )
    }
    return trimmed
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
