/**
 * JSON 文件词库 Provider（当前默认实现）。
 *
 * 职责链：读取文件 → Zod 严格校验（含 category ⊆ category_enum 交叉校验）→
 * 规范化（ID 生成 / 缺省值回填 / enabled 与语言过滤 / 去重）→ 内容哈希版本号。
 * 任何异常数据都以带中文文案的 Error 阻止启动，绝不带病运行。
 *
 * 文件结构（示例见 vocabulary/draw_guess_words_zh-CN_v2.json）：
 * {
 *   version, updated_at, default_time_limit, default_score_weight,
 *   category_enum: string[],          // 分类白名单
 *   words: [{ id, type, text, category[], difficulty, hint[], tags[],
 *             lang, enabled, time_limit, score_weight, aliases[] }]
 * }
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { APP_CONFIG } from '../../../../config.ts'
import { serverStrings } from '../../../../config/strings.ts'
import type { VocabularyWord } from '@draw-guess/shared'
import type { LoadedVocabulary, VocabularyProvider } from './contract.ts'
import { assertNoDuplicateText, canonicalWordId, hashWords } from './normalize.ts'

/** 单条别称：可见非空白字符，长度受配置约束（校验阶段裁剪掉首尾空白） */
const AliasSchema = z.string().trim().min(1).max(APP_CONFIG.vocabulary.maxAliasLength)

/** 单条结构化提示 */
const HintSchema = z.string().trim().min(1).max(APP_CONFIG.vocabulary.maxHintLength)

/** 词库文件顶层 schema：words 先宽松解析，词条级 schema 在拿到 category_enum 后再严格构建（交叉校验）。 */
const FileHeaderSchema = z.object({
  version: z.string().trim().min(1).max(32),
  updated_at: z.string().trim().min(1).max(32),
  default_time_limit: z.number().int().positive().max(3_600),
  default_score_weight: z.number().int().positive().max(1_000),
  category_enum: z.array(z.string().trim().min(1).max(24)).min(1).max(200),
  words: z.array(z.record(z.string(), z.unknown())).min(1),
})

/** 词条类型：本项目仅支持 'word'，其他类型明确报错而非静默跳过。 */
const WORD_TYPE = 'word'

/**
 * 构建词条级 schema：category 必须是 category_enum 的子集（交叉校验），
 * 因此无法在模块顶层静态定义，只能由 Provider 在读取文件后动态构建。
 */
function buildWordSchema(categoryEnum: readonly string[]) {
  const categorySet = new Set(categoryEnum)
  return z
    .object({
      id: z.number().int().positive(),
      type: z.literal(WORD_TYPE),
      text: z.string().trim().min(1).max(APP_CONFIG.vocabulary.maxWordLength),
      category: z.array(z.string().trim().min(1)).max(APP_CONFIG.vocabulary.maxCategoriesPerWord),
      difficulty: z
        .number()
        .int()
        .min(APP_CONFIG.vocabulary.difficultyRange.min)
        .max(APP_CONFIG.vocabulary.difficultyRange.max),
      hint: z.array(HintSchema).max(APP_CONFIG.vocabulary.maxHintsPerWord),
      tags: z.array(z.string().trim().min(1).max(24)).max(APP_CONFIG.vocabulary.maxTagsPerWord),
      lang: z.string().trim().min(2).max(12),
      enabled: z.boolean(),
      time_limit: z.number().int().positive().max(3_600),
      score_weight: z.number().int().positive().max(1_000),
      aliases: z.array(AliasSchema).max(APP_CONFIG.vocabulary.maxAliasesPerWord),
    })
    .strict() // 禁止未知字段：词库文件写错字段名（如 text写成title）时立即暴露而非静默丢失
    .superRefine((word, ctx) => {
      // 交叉校验：每个分类都必须在 category_enum 白名单内
      for (const category of word.category) {
        if (!categorySet.has(category)) {
          ctx.addIssue({
            code: 'custom',
            message: `词条「${word.text}」的分类「${category}」不在 category_enum 白名单内`,
          })
        }
      }
      // 分类不允许重复
      if (new Set(word.category).size !== word.category.length) {
        ctx.addIssue({ code: 'custom', message: `词条「${word.text}」的分类存在重复项` })
      }
      // 别称不允许与词面重复（判定时冗余）
      const normalizedText = word.text
      if (word.aliases.some((alias) => alias === normalizedText)) {
        ctx.addIssue({ code: 'custom', message: `词条「${word.text}」的别称与词面重复` })
      }
    })
}

/** JSON 文件词库 Provider 实现。 */
export class JsonFileProvider implements VocabularyProvider {
  readonly sourceId = 'json-file'

  constructor(
    /** 词库文件的绝对/相对路径（相对项目根或进程工作目录，见 resolveCandidatePaths） */
    private readonly filePath: string,
    private readonly encoding: string = APP_CONFIG.vocabulary.encoding,
  ) {}

  async load(): Promise<LoadedVocabulary> {
    const raw = await this.readWithFallback()
    const source = JSON.parse(raw.text) as unknown
    const header = FileHeaderSchema.parse(source)

    const wordSchema = buildWordSchema(header.category_enum)
    // 逐词条 parse：把 Zod 的字段路径转成「第 N 个词条」的中文定位，方便词库作者修正
    const parsedWords: VocabularyWord[] = []
    for (const [index, rawWord] of header.words.entries()) {
      const result = wordSchema.safeParse(rawWord)
      if (!result.success) {
        const issue = result.error.issues[0]
        const location = issue?.path.length ? `字段 ${issue.path.join('.')}` : '结构'
        throw new Error(
          `词库文件第 ${index + 1} 个词条校验失败（${location}）：${issue?.message ?? '未知问题'}`,
        )
      }
      const word = result.data
      // enabled=false 的词条直接跳过：不进入候选池，也不参与去重与版本哈希
      if (!word.enabled) continue
      // 语言白名单：不在名单内的词条视为异常数据（多半是作者写错 lang），阻止启动
      if (!(APP_CONFIG.vocabulary.languages as readonly string[]).includes(word.lang)) {
        throw new Error(
          `词条「${word.text}」的语言「${word.lang}」不在白名单（${APP_CONFIG.vocabulary.languages.join('、')}）内`,
        )
      }
      parsedWords.push({
        id: canonicalWordId(this.sourceId, word.id),
        text: word.text,
        aliases: word.aliases,
        categories: word.category,
        difficulty: word.difficulty,
        hints: word.hint,
        tags: word.tags,
        lang: word.lang,
        // 文件已为每词条提供 time_limit/score_weight；保留可选语义：缺省时回退文件级默认
        timeLimit: word.time_limit ?? header.default_time_limit,
        scoreWeight: word.score_weight ?? header.default_score_weight,
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
        fileVersion: header.version,
        updatedAt: header.updated_at,
        categoryEnum: header.category_enum,
        defaultTimeLimit: header.default_time_limit,
        defaultScoreWeight: header.default_score_weight,
      },
    }
  }

  /** 读取文件内容：优先项目根目录，找不到时回退进程工作目录（兼容根级与 workspace filter 启动）。 */
  private async readWithFallback(): Promise<{ text: string; path: string }> {
    const candidates = [
      path.resolve(process.cwd(), '../..', this.filePath),
      path.resolve(process.cwd(), this.filePath),
    ]
    const unique = [...new Set(candidates)]
    let lastError: unknown
    for (const candidate of unique) {
      try {
        const text = await readFile(candidate, this.encoding as BufferEncoding)
        return { text, path: candidate }
      } catch (error) {
        lastError = error
        // 仅在文件不存在时尝试下一个候选路径，其他错误（权限等）直接抛出
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') break
      }
    }
    throw new Error(
      `词库文件不存在：${this.filePath}（已尝试：${unique.join('、')}）。原因：${lastError instanceof Error ? lastError.message : String(lastError)}`,
    )
  }
}
