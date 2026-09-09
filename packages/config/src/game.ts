import { ROOM_RULE_LIMITS } from '@draw-guess/shared'
import { ROOM_PRESETS } from './room-presets.ts'

/**
 * 领域配置：对局默认规则与计分；可提交范围复用 shared 协议约束。
 */
export const game = {
  roundsPerPlayer: {
    ...ROOM_RULE_LIMITS.roundsPerPlayer,
    default: ROOM_PRESETS.standard.roundsPerPlayer,
    step: 1,
  },
  drawSeconds: {
    ...ROOM_RULE_LIMITS.drawSeconds,
    default: ROOM_PRESETS.standard.drawSeconds,
    step: 15,
  },
  chooseSeconds: {
    ...ROOM_RULE_LIMITS.chooseSeconds,
    default: ROOM_PRESETS.standard.chooseSeconds,
    step: 5,
  },
  optionCount: {
    ...ROOM_RULE_LIMITS.optionCount,
    default: ROOM_PRESETS.standard.optionCount,
    step: 1,
  },
  startingCountdownSeconds: 3, // 开局倒计时
  roundResultSeconds: 6, // 回合结算展示时长
  /** 作画阶段剩余秒数低于该值时进入“紧急”视觉/音效提示（GameHud 与 useAudioFeedback 共用，避免重复硬编码）。 */
  warningSeconds: 10,
  /** 逐步提示时间窗口比例：在作画时间的后半程开始逐步揭示字符（0.5 = 后 50% 时间开始） */
  progressiveHintRatio: 0.5,
  // —— 房间规则可设置项的默认值（RulesDialog/LobbyView 初始值均从这取，禁止另写一套）——
  structuredHintsEnabled: ROOM_PRESETS.standard.structuredHintsEnabled,
  hintStartRatio: ROOM_PRESETS.standard.hintStartRatio,
  /** 结构化提示开始时机滑块的合法区间（剩余时间比例 10%~90%，步进 5%）。 */
  hintStartRatioRange: { ...ROOM_RULE_LIMITS.hintStartRatio, step: 0.05 },
  scoreMode: ROOM_PRESETS.standard.scoreMode,
  showWordLength: ROOM_PRESETS.standard.showWordLength,
  progressiveHints: ROOM_PRESETS.standard.progressiveHints,
  allowWordReroll: ROOM_PRESETS.standard.allowWordReroll,
  // 猜词比较固定为：NFKC 规范化 → 去首尾空白 → 折叠连续空白 → 忽略拉丁大小写（由 shared normalizeAnswer 内置）
  score: {
    guessBase: ROOM_PRESETS.standard.guessBaseScore,
    defaultWordWeight: 5, // 词条 score_weight 缺省时的计分基准
    /** 房间规则“统一猜词基础分”滑块合法区间（步进 50，覆盖全局默认值）。 */
    guessBaseRange: { ...ROOM_RULE_LIMITS.guessBaseScore, step: 50 },
    maxSpeedBonus: 700, // 速度奖励上限
    orderBonuses: [100, 60, 30, 0, 0], // 猜中顺序奖励（前 3 名）
    drawerPerCorrect: 120, // 画家每个猜中者得分
    drawerAllCorrectBonus: 100, // 画家全员猜中奖励
  },
} as const
