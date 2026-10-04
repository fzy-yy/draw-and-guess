import { DRAW_SECONDS_OPTIONS, ROOM_RULE_LIMITS } from '@draw-guess/shared/protocol/constants'
import type { RoomSettings } from '@draw-guess/shared'
import { relay } from './relay.ts'

/**
 * 领域配置：对局默认规则与计分；可提交范围复用 shared 协议约束。
 *
 * 旧「玩法预设」（标准/轻松/竞速三档）已移除：房间规则只保留唯一默认组
 * `roomSettingsDefaults`，建房与规则弹窗初始草稿、服务端默认设置与规则摘要
 * 对照基线统一从它取值，禁止另写一套。计分固定为 100 分制：猜词者按本回合猜中顺序得
 * 100/80/60/40/20，画家每个猜中者 20 分、单回合上限 100
 *（见 docs/adr/0047-fixed-100-point-scoring.md）。
 */

/** 房间规则默认基线（容量固定为协议常量，不属可调规则）。 */
export const roomSettingsDefaults = {
  roundsPerPlayer: 2,
  drawSeconds: 120,
  chooseSeconds: 15,
  allowChooseTimeLimit: false,
  optionCount: 3,
  showWordLength: true,
  progressiveHints: true,
  allowPlayerInvite: true,
  allowPause: true,
  allowWordReroll: true,
  allowCustomWord: false,
  allowNearMissHint: true,
  allowCanvasReactions: true,
  allowRoundReplay: true,
  // 接龙三时长默认值来自 relay 配置（接龙房间才生效，经典房间保留但不参与推进）
  relayChooseSeconds: relay.chooseSeconds.default,
  relayDrawSeconds: relay.drawSeconds.default,
  relayGuessSeconds: relay.guessSeconds.default,
} as const satisfies RoomSettings

/** 完整合法的默认房间规则设置（容量固定，不按建房场景注入）。 */
export function defaultRoomSettings(): RoomSettings {
  return { ...roomSettingsDefaults }
}

export const game = {
  roundsPerPlayer: {
    ...ROOM_RULE_LIMITS.roundsPerPlayer,
    default: roomSettingsDefaults.roundsPerPlayer,
    step: 1,
  },
  drawSeconds: {
    options: DRAW_SECONDS_OPTIONS,
    default: roomSettingsDefaults.drawSeconds,
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
  startingCountdownSeconds: 3, // 开局倒计时
  roundReplaySeconds: 3, // 回合结束作画精彩重播时长（3 秒，可在 config 中配置）
  roundReplayPauseSeconds: 1, // 重播结束至弹出结算弹窗之间的画作静止展示停顿时长（1 秒，可在 config 中配置）
  roundResultSeconds: 5, // 回合结算展示时长（5 秒，可在 config 中配置）
  /** 作画阶段剩余秒数低于该值时进入“紧急”视觉/音效提示（GameHud 与 useAudioFeedback 共用，避免重复硬编码）。 */
  warningSeconds: 10,
  /** 逐步提示时间窗口比例：在作画时间的后半程开始逐步揭示字符（0.5 = 后 50% 时间开始） */
  progressiveHintRatio: 0.5,
  // 猜词比较固定为：NFKC 规范化 → 去首尾空白 → 折叠连续空白 → 忽略拉丁大小写（由 shared normalizeAnswer 内置）
  score: {
    /** 猜中顺序得分表：第 1/2/3/4/5 名依次得分；超出表长按最后一档计。 */
    orderScores: [100, 80, 60, 40, 20],
    drawerPerCorrect: 20, // 画家每个猜中者得分
    drawerMaxScore: 100, // 画家单回合得分上限
  },
} as const
