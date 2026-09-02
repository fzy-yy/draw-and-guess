/**
 * 领域配置：词库来源与校验预算。
 *
 * 词库加载采用 Provider 架构（见 apps/server/src/vocabulary/contract.ts）：
 * 领域层只依赖 VocabularyProvider 接口，具体来源由 provider 字段选择。
 * 将来切换 SQLite 词库：新增一个 Provider 实现并把 provider 改为对应标识即可，领域代码零改动。
 */
export const vocabulary = {
  /** 词库来源实现标识（扩展点：'json-file' | 将来 'sqlite' 等） */
  provider: 'json-file' as const,
  /** 词库文件路径（相对项目根目录；亦支持相对进程工作目录回退） */
  filePath: 'vocabulary/draw_guess_words_zh-CN_v2.json',
  encoding: 'utf8' as const,
  /** 词库最小词条数（也是每局最少选择数；随词库扩充可调回更大值） */
  minWords: 6,
  /** 词库及单次选择提交上限，为后续 5000+ 词条预留空间 */
  maxWords: 10_000,
  /** 单条词面最大字符数 */
  maxWordLength: 24,
  /** 单词条别称上限（防止异常文件撑爆快照） */
  maxAliasesPerWord: 8,
  /** 单条别称最大字符数 */
  maxAliasLength: 24,
  /** 单词条结构化提示条数上限 */
  maxHintsPerWord: 4,
  /** 单条提示最大字符数 */
  maxHintLength: 120,
  /** 单词条分类上限 */
  maxCategoriesPerWord: 3,
  /** 单词条标签上限 */
  maxTagsPerWord: 8,
  /** 语言白名单：不在名单内的词条视为异常数据，阻止启动 */
  languages: ['zh-CN'],
  /** 词条类型白名单：JSON 词库的 type 字段仅允许这些值，其余视为异常数据阻止启动 */
  wordTypes: ['word', 'phrase', 'scene'],
  /** 难度合法区间（1 最易） */
  difficultyRange: { min: 1, max: 5 },
  /** 按规范化词面去重（重复词面视为异常数据） */
  deduplicate: true,
  /** 词池用完后允许重新启用全部词条 */
  resetWhenExhausted: true,
  /**
   * 是否允许词条级 time_limit 覆盖房间统一作画秒数。
   * 生效值会钳制到 game.drawSeconds.min/max 区间，防止词库文件写越界值。
   */
  useWordTimeLimit: true,
  /**
   * 是否启用词条级 score_weight 参与计分。
   * 计分语义（倍率/加权基准）尚未确认，本期仅透传进数据模型，默认关闭。
   */
  useWordScoreWeight: false,
} as const
