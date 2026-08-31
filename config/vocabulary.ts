/**
 * 领域配置：词库。
 * 归入根级 config/ 目录后由 config.ts 聚合，保持“唯一业务配置中心”不变。
 */
export const vocabulary = {
  filePath: 'vocabulary.md', // 唯一词库文件路径
  encoding: 'utf8' as const,
  minWords: 12, // 词库最小词条数（也是每局最少选择数）
  maxWords: 10_000, // 词库及单次选择提交上限，为后续 5000+ 词条预留空间
  maxWordLength: 24, // 单条词面最大字符数
  deduplicate: true, // 按规范化词面去重
  resetWhenExhausted: true, // 词池用完后允许重新启用全部词条
} as const
