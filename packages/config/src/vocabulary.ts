/** 浏览器会展示或提交的词库公开范围；Provider、数据库路径和校验资源预算留在服务端。 */
export const vocabulary = {
  /**
   * 词库加载门槛：Provider 校验通过所需的最小有效词条数（决定「库是否可用」）。
   * 注意：每局最少选择数是协议常量 MIN_SELECTED_VOCABULARY_WORDS（60），
   * 与本加载门槛无关；6～59 词的库可加载，但作为房间词库会被选中门槛拒绝。
   */
  minWords: 6,
  /** 单条词面最大字符数 */
  maxWordLength: 24,
} as const
