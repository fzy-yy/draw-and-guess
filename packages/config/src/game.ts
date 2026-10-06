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

/**
 * 房间规则默认基线（容量固定为协议常量，不属可调规则）。
 * 建房与规则弹窗的初始草稿、服务端房间初始设置、规则摘要对照基线都取自这里。
 */
export const roomSettingsDefaults = {
  /** 每人当一次画家的回合数（一轮一题）。 */
  roundsPerPlayer: 2,
  /** 每回合作画时长（秒）。 */
  drawSeconds: 120,
  /** 选词阶段倒计时（秒），超时由服务端随机选词开画。 */
  chooseSeconds: 15,
  /** 选词阶段提供的候选词个数。 */
  optionCount: 3,
  /** 是否向猜词者显示题目字数。 */
  showWordLength: true,
  /** 是否启用逐步提示（在作画后半程逐格揭示字符）。 */
  progressiveHints: true,
  /** 是否允许房主之外的成员互相发送邀请。 */
  allowPlayerInvite: true,
  /** 是否允许画家更换一组候选词。 */
  allowWordReroll: true,
  /** 是否允许画家输入自定义题目（默认关闭）。 */
  allowCustomWord: false,
  /** 是否在猜词接近答案时给出「接近了」提示。 */
  allowNearMissHint: true,
  /** 是否允许画布表情等互动反馈。 */
  allowCanvasReactions: true,
  /** 是否在回合结束时重播本回合画作。 */
  allowRoundReplay: true,
  /** 接龙模式选词时长默认值（仅接龙房间生效，经典房间保留但不参与推进）。 */
  relayChooseSeconds: relay.chooseSeconds.default,
  /** 接龙模式作画时长默认值（仅接龙房间生效）。 */
  relayDrawSeconds: relay.drawSeconds.default,
  /** 接龙模式猜词时长默认值（仅接龙房间生效）。 */
  relayGuessSeconds: relay.guessSeconds.default,
} as const satisfies RoomSettings

/** 完整合法的默认房间规则设置（容量固定，不按建房场景注入）。 */
export function defaultRoomSettings(): RoomSettings {
  return { ...roomSettingsDefaults }
}

export const game = {
  /** 每人回合数：可调区间与步长来自协议常量，默认值取自规则基线。 */
  roundsPerPlayer: {
    ...ROOM_RULE_LIMITS.roundsPerPlayer,
    /** 建房默认每人回合数。 */
    default: roomSettingsDefaults.roundsPerPlayer,
    /** 规则弹窗中该档位的调节步长。 */
    step: 1,
  },
  /** 每回合作画时长：可选档位来自协议常量。 */
  drawSeconds: {
    /** 可选的作画时长档位（秒）。 */
    options: DRAW_SECONDS_OPTIONS,
    /** 建房默认可作画时长（秒）。 */
    default: roomSettingsDefaults.drawSeconds,
  },
  /** 选词倒计时：可调区间与步长来自协议常量。 */
  chooseSeconds: {
    ...ROOM_RULE_LIMITS.chooseSeconds,
    /** 建房默认选词倒计时（秒）。 */
    default: roomSettingsDefaults.chooseSeconds,
    /** 规则弹窗中该档位的调节步长（秒）。 */
    step: 5,
  },
  /** 候选词个数：可调区间与步长来自协议常量。 */
  optionCount: {
    ...ROOM_RULE_LIMITS.optionCount,
    /** 建房默认候选词个数。 */
    default: roomSettingsDefaults.optionCount,
    /** 规则弹窗中该档位的调节步长。 */
    step: 1,
  },
  /** 开局倒计时（秒，全屏大字倒数与阶段切入门槛）。 */
  startingCountdownSeconds: 3,
  /** 回合结束作画精彩重播时长（秒，可在 config 中配置）。 */
  roundReplaySeconds: 3,
  /** 重播结束至弹出结算弹窗之间的画作静止展示停顿时长（秒，可在 config 中配置）。 */
  roundReplayPauseSeconds: 1,
  /** 回合结算展示时长（秒，可在 config 中配置）。 */
  roundResultSeconds: 5,
  /** 作画阶段剩余秒数低于该值时进入“紧急”视觉/音效提示（GameHud 与 useAudioFeedback 共用，避免重复硬编码）。 */
  warningSeconds: 10,
  /** 逐步提示时间窗口比例：在作画时间的后半程开始逐步揭示字符（0.5 = 后 50% 时间开始） */
  progressiveHintRatio: 0.5,
  // 猜词比较固定为：NFKC 规范化 → 去首尾空白 → 折叠连续空白 → 忽略拉丁大小写（由 shared normalizeAnswer 内置）
  /** 固定 100 分制的计分参数（服务端 scoring.ts 消费）。 */
  score: {
    /** 猜中顺序得分表：第 1/2/3/4/5 名依次得分；超出表长按最后一档计。 */
    orderScores: [100, 80, 60, 40, 20],
    /** 画家每个猜中者得分。 */
    drawerPerCorrect: 20,
    /** 画家单回合得分上限。 */
    drawerMaxScore: 100,
  },
} as const
