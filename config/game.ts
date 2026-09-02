/**
 * 领域配置：对局规则与计分。
 * 归入根级 config/ 目录后由 config.ts 聚合，保持“唯一业务配置中心”不变。
 */
export const game = {
  roundsPerPlayer: { min: 1, max: 5, default: 2, step: 1 }, // 每人作画轮数
  drawSeconds: { min: 45, max: 180, default: 90, step: 15 }, // 每回合作画秒数
  chooseSeconds: { min: 10, max: 30, default: 15, step: 5 }, // 选词阶段秒数
  optionCount: { min: 2, max: 5, default: 3, step: 1 }, // 候选词数量
  startingCountdownSeconds: 3, // 开局倒计时
  roundResultSeconds: 6, // 回合结算展示时长
  finalHintThresholds: [0.35, 0.2], // 逐字揭示遮罩的剩余时间比例阈值（独立于结构化提示）
  // —— 房间规则可设置项的默认值（RulesDialog/LobbyView 初始值均从这取，禁止另写一套）——
  structuredHintsEnabled: true, // 默认开启结构化提示（词条 hint 按阈值揭示）
  hintStartRatio: 0.35, // 结构化提示开始时机：剩余比例降到该值时揭示第一条
  hintIntervalRatio: 0.15, // 词条多条提示时相邻两条揭示时机的剩余比例间隔
  scoreMode: 'standard' as const, // 猜词分数计算方式默认值（standard=基础+速度+顺序）
  showWordLength: true, // 默认显示答案字数
  progressiveHints: true, // 默认开启逐步提示
  closeGuessEnabled: true, // 默认开启近似答案提示
  // 猜词比较固定为：NFKC 规范化 → 去首尾空白 → 折叠连续空白 → 忽略拉丁大小写（由 shared normalizeAnswer 内置）
  score: {
    guessBase: 300, // 猜中基础分（全局默认值；房间规则可用 guessBaseScore 覆盖）
    maxSpeedBonus: 700, // 速度奖励上限
    orderBonuses: [100, 60, 30, 0, 0], // 猜中顺序奖励（前 3 名）
    drawerPerCorrect: 120, // 画家每个猜中者得分
    drawerAllCorrectBonus: 100, // 画家全员猜中奖励
  },
} as const
