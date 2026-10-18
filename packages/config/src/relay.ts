import {
  RELAY_CHOOSE_SECONDS_OPTIONS,
  RELAY_DRAW_SECONDS_OPTIONS,
  RELAY_GUESS_SECONDS_OPTIONS,
} from '@draw-guess/shared/protocol/constants'

/**
 * 接龙模式配置（S17 / S39 / 治理 §7.1）。
 *
 * 三类对局时长：档位白名单来自共享协议常量（线上可观察范围），**默认值**落在这里——
 * 默认值不是协议约定而是产品选择，房间规则与规则弹窗初值统一从这里取。
 *
 * 复盘固定节奏（replaySeconds / replayPauseSeconds / revealSeconds / voteSeconds /
 * voteAllSubmittedSeconds）与下面的计分、占位字符数都是**固定常量**、房主不可改：每链节奏由
 * 服务端权威计时与客户端动画共用同一份，改这里即两端同步改变。接龙不新增服务端私有策略
 *（沿用断线宽限、限频与幂等缓存上限）。
 */
export const relay = {
  /** 选词时长（步 1 的 `relay_choose`）：可选档位与默认值。 */
  chooseSeconds: {
    /** 可选档位（秒，协议白名单）。 */
    options: RELAY_CHOOSE_SECONDS_OPTIONS,
    /** 建房默认选词时长（秒）。 */
    default: 20,
  },
  /** 作画时长（步 1/3 的 `relay_draw`）：每幅画独立计时，可选档位与默认值。 */
  drawSeconds: {
    /** 可选档位（秒，协议白名单）。 */
    options: RELAY_DRAW_SECONDS_OPTIONS,
    /** 建房默认作画时长（秒）。 */
    default: 90,
  },
  /** 猜词时长（步 2/4 的 `relay_guess`）：可选档位与默认值。 */
  guessSeconds: {
    /** 可选档位（秒，协议白名单）。 */
    options: RELAY_GUESS_SECONDS_OPTIONS,
    /** 建房默认猜词时长（秒）。 */
    default: 45,
  },
  /** 复盘：每半场的作画重播时长（秒）。 */
  replaySeconds: 3,
  /** 复盘：重播结束到揭晓之间的画作静止停顿（秒）。 */
  replayPauseSeconds: 1,
  /** 复盘：揭晓答案的展示时长（秒）。 */
  revealSeconds: 3,
  /** 投票时长上限（秒）：到点必结算；链阵容全员投完后压缩到下面的收尾窗口（ADR-0063）。 */
  voteSeconds: 10,
  /**
   * 全员投完后的收尾窗口（秒）：链阵容每个人都投过票时，把本次投票的剩余时间压到该值；
   * 剩余已不足该值时原样不动（既不延长也不缩短）。留这一小段是为了让最后一票的票行被看见，
   * 而不是收齐即瞬切下一条链（ADR-0063）。
   */
  voteAllSubmittedSeconds: 3,
  /**
   * 链匹配成功时「每张赞同票」给该链 4 名参与者带来的分数（S13）。
   * 定 10 是为了与经典的 100 分制同量级：一条链最多 N 张赞同票（N＝人数），
   * 4 人局一条全票通过的链正好 40 分、四条链满分 160，比经典单人满分 100 略高，
   * 让「越多人认可、大家都赚得越多」的激励在两种模式下体感一致（S24 不做归一化）。
   */
  scorePerAgreeVote: 10,
  /** 复盘胶囊过渡（右答案平移到左、左答案渐隐、chip 就地换人）的动画时长（毫秒）。 */
  capsuleTransitionMs: 400,
  /**
   * 未揭晓答案的固定占位字符数（S81）。
   * 服务端不下发未揭晓答案的长度，占位因此取固定位数而不是按真实字数生成下划线。
   */
  hiddenAnswerChars: 4,
} as const
