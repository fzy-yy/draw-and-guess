/** 浏览器会展示或提交的词库公开范围；Provider、数据库路径和校验资源预算留在服务端。 */
export const vocabulary = {
  /** 词库最小词条数（也是每局最少选择数；随词库扩充可调回更大值） */
  minWords: 6,
  /** 单条词面最大字符数 */
  maxWordLength: 24,
} as const
