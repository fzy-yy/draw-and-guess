/**
 * 领域配置：词库来源与校验预算。
 *
 * 词库加载采用 Provider 架构（见 apps/server/src/vocabulary/contract.ts）：
 * 领域层只依赖 VocabularyProvider 接口，具体来源由 provider 字段选择。
 * 词库已由 JSON 文件迁移为 SQLite 数据库（同目录 vocabulary/draw_guess_words.db）：
 * words 表（id/text/category/difficulty/enabled/time_limit/score_weight/aliases）
 * + metadata 表（category_enum/time_limit_enum/difficulty_enum/score_weight_enum/default_*）。
 * JSON 词库文件已被弃用，不再读取。
 */
export const vocabulary = {
  /** 词库来源实现标识（扩展点：'sqlite' | 将来其它来源） */
  provider: 'sqlite' as const,
  /** 词库 SQLite 数据库文件路径（相对项目根目录；亦支持相对进程工作目录回退） */
  dbPath: 'vocabulary/draw_guess_words.db',
  /** 词库最小词条数（也是每局最少选择数；随词库扩充可调回更大值） */
  minWords: 6,
  /** 词库及单次选择提交上限，为后续 5000+ 词条预留空间 */
  maxWords: 10_000,
  /** 单条词面最大字符数 */
  maxWordLength: 24,
  /** 单词条别称上限（防止异常数据撑爆快照） */
  maxAliasesPerWord: 8,
  /** 单条别称最大字符数 */
  maxAliasLength: 24,
  /** 难度合法区间（1 最易） */
  difficultyRange: { min: 1, max: 5 },
  /** 按规范化词面去重（重复词面视为异常数据） */
  deduplicate: true,
  /** 词池用完后允许重新启用全部词条 */
  resetWhenExhausted: true,
  /**
   * 是否允许词条级 time_limit 覆盖房间统一作画秒数。
   * 生效值会钳制到 game.drawSeconds.min/max 区间，防止词库写越界值。
   */
  useWordTimeLimit: true,
  /**
   * 是否启用词条级 score_weight 参与计分。
   * 计分语义（倍率/加权基准）尚未确认，本期仅透传进数据模型，默认关闭。
   */
  useWordScoreWeight: false,
} as const
