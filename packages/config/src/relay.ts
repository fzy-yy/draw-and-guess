import {
  RELAY_CHOOSE_SECONDS_OPTIONS,
  RELAY_DRAW_SECONDS_OPTIONS,
  RELAY_GUESS_SECONDS_OPTIONS,
} from '@draw-guess/shared/protocol/constants'

/**
 * 接龙模式配置（S17 / S39 / 治理 §7.1）。
 *
 * 三类对局时长：档位白名单来自共享协议常量（线上可观察范围），**默认值**落在这里——
 * 默认值不是协议约定而是产品选择（20 / 90 / 45），房间规则与规则弹窗初值统一从这里取。
 *
 * 复盘四时长（重播 3 / 停顿 1 / 揭晓 3 / 投票 10）是**固定常量**、房主不可改：
 * 每链 24 秒的节奏由服务端权威计时与客户端动画共用同一份，改这里即两端同步改变。
 * 接龙不新增服务端私有策略（沿用断线宽限、限频与幂等缓存上限）。
 */
export const relay = {
  /** 选词时长（步 1 的 `relay_choose`）。 */
  chooseSeconds: {
    options: RELAY_CHOOSE_SECONDS_OPTIONS,
    default: 20,
  },
  /** 作画时长（步 1/3 的 `relay_draw`），每幅画独立计时。 */
  drawSeconds: {
    options: RELAY_DRAW_SECONDS_OPTIONS,
    default: 90,
  },
  /** 猜词时长（步 2/4 的 `relay_guess`）。 */
  guessSeconds: {
    options: RELAY_GUESS_SECONDS_OPTIONS,
    default: 45,
  },
  /** 复盘：每半场的作画重播时长（秒）。 */
  replaySeconds: 3,
  /** 复盘：重播结束到揭晓之间的画作静止停顿（秒）。 */
  replayPauseSeconds: 1,
  /** 复盘：揭晓答案的展示时长（秒）。 */
  revealSeconds: 3,
  /** 投票时长（秒）：一律等满，从不提前公布（S21）。 */
  voteSeconds: 10,
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
