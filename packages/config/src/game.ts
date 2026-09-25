import { ROOM_RULE_LIMITS } from '@draw-guess/shared/protocol/constants'
import type { RoomSettings } from '@draw-guess/shared'

/**
 * 领域配置：对局默认规则与计分；可提交范围复用 shared 协议约束。
 *
 * 旧「玩法预设」（标准/轻松/竞速三档）已移除：房间规则只保留唯一默认组
 * `roomSettingsDefaults`，建房与规则弹窗初始草稿、服务端默认设置与规则摘要
 * 对照基线统一从它取值，禁止另写一套。计分方式也已固定为标准
 * （基础 + 速度 + 顺序，见 shared pure.ts calculateGuessScore）。
 */

/** 房间规则默认基线（不含容量；容量按建房场景注入）。 */
export const roomSettingsDefaults = {
  roundsPerPlayer: 2,
  drawSeconds: 90,
  chooseSeconds: 15,
  optionCount: 3,
  showWordLength: true,
  progressiveHints: true,
  structuredHintsEnabled: true,
  hintStartRatio: 0.35,
  guessBaseScore: 300,
  /** 额外猜词时间：默认 0（不额外增加），叠加在难度派生时限之上。 */
  extraGuessSeconds: 0,
  allowPlayerInvite: true,
  allowPause: true,
  allowWordReroll: true,
  joinPolicy: 'next_game',
} as const satisfies Omit<RoomSettings, 'maxPlayers'>

/** 由容量生成完整合法的默认房间规则设置。 */
export function defaultRoomSettings(maxPlayers: number): RoomSettings {
  return { maxPlayers, ...roomSettingsDefaults }
}

export const game = {
  roundsPerPlayer: {
    ...ROOM_RULE_LIMITS.roundsPerPlayer,
    default: roomSettingsDefaults.roundsPerPlayer,
    step: 1,
  },
  drawSeconds: {
    ...ROOM_RULE_LIMITS.drawSeconds,
    default: roomSettingsDefaults.drawSeconds,
    step: 15,
  },
  chooseSeconds: {
    ...ROOM_RULE_LIMITS.chooseSeconds,
    default: roomSettingsDefaults.chooseSeconds,
    step: 5,
  },
  optionCount: {
    ...ROOM_RULE_LIMITS.optionCount,
    default: roomSettingsDefaults.optionCount,
    step: 1,
  },
  /**
   * 额外猜词时间滑块：在词条难度派生时限（或作画时间回退）之上叠加的秒数。
   * 合法区间来自协议 ROOM_RULE_LIMITS（0~90，改上限只动 shared 常量），步进 5。
   */
  extraGuessSeconds: {
    ...ROOM_RULE_LIMITS.extraGuessSeconds,
    default: roomSettingsDefaults.extraGuessSeconds,
    step: 5,
  },
  startingCountdownSeconds: 3, // 开局倒计时
  roundResultSeconds: 6, // 回合结算展示时长
  /** 作画阶段剩余秒数低于该值时进入“紧急”视觉/音效提示（GameHud 与 useAudioFeedback 共用，避免重复硬编码）。 */
  warningSeconds: 10,
  /** 逐步提示时间窗口比例：在作画时间的后半程开始逐步揭示字符（0.5 = 后 50% 时间开始） */
  progressiveHintRatio: 0.5,
  // —— 房间规则可设置项的区间与步进（默认值一律取 roomSettingsDefaults）——
  /** 结构化提示开始时机滑块的合法区间（剩余时间比例 10%~90%，步进 5%）。 */
  hintStartRatioRange: { ...ROOM_RULE_LIMITS.hintStartRatio, step: 0.05 },
  // 猜词比较固定为：NFKC 规范化 → 去首尾空白 → 折叠连续空白 → 忽略拉丁大小写（由 shared normalizeAnswer 内置）
  score: {
    defaultWordWeight: 5, // 词条 score_weight 缺省时的计分基准
    /** 房间规则“统一猜词基础分”滑块合法区间（步进 50，覆盖默认值）。 */
    guessBaseRange: { ...ROOM_RULE_LIMITS.guessBaseScore, step: 50 },
    maxSpeedBonus: 700, // 速度奖励上限
    orderBonuses: [100, 60, 30, 0, 0], // 猜中顺序奖励（前 3 名）
    drawerPerCorrect: 120, // 画家每个猜中者得分
    drawerAllCorrectBonus: 100, // 画家全员猜中奖励
  },
} as const
