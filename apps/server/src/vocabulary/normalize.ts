/**
 * 词库加载共享纯函数：词条 ID 生成、内容哈希、去重。
 * 与具体来源（SQLite / 将来的其它来源）解耦，各 Provider 复用，
 * 保证无论来源如何，内存领域层拿到的词条 ID 与版本号语义一致。
 */
import { createHash } from 'node:crypto'
import { normalizeAnswer, type VocabularyWord } from '@draw-guess/shared'

/**
 * 由来源标识与原始主键生成全局稳定的词条 ID。
 * 拼入来源前缀可避免将来多来源并存（如 SQLite + 扩充包）时主键冲突；
 * 字符集限定在 WordIdSchema 允许的 [A-Za-z0-9:_-] 内。
 */
export function canonicalWordId(source: string, rawId: string | number): string {
  return `${source}:${String(rawId)}`
}

/**
 * 计算词库内容哈希版本号（sha256 前 12 位 hex）。
 * 输入包含 id/text/aliases/category/difficulty/drawability/hint 与加载期派生的
 * timeLimit/scoreWeight 等全部玩法相关字段，
 * 任何内容变化都会得到新版本号，供客户端对比与房间词库重置判断。
 */
export function hashWords(words: VocabularyWord[]): string {
  const canonical = words
    .map((word) =>
      [
        word.id,
        word.text,
        word.aliases.join(','),
        word.category,
        word.difficulty,
        word.drawability,
        word.hint,
        word.timeLimit ?? '',
        word.scoreWeight ?? '',
      ].join('§'),
    )
    .join('\n')
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12)
}

/**
 * 按规范化词面去重（保持首次出现的原始写法）。
 * 词库数据中出现重复词面视为异常数据：直接报错而不是静默丢弃，
 * 避免作者以为写入了新词条却实际被吞掉。
 */
export function assertNoDuplicateText(words: VocabularyWord[]): void {
  const seen = new Map<string, string>()
  for (const word of words) {
    const normalized = normalizeAnswer(word.text)
    const first = seen.get(normalized)
    if (first !== undefined) {
      throw new Error(`词库存在重复词面：「${word.text}」与「${first}」重复，请修正词库文件。`)
    }
    seen.set(normalized, word.text)
  }
}
