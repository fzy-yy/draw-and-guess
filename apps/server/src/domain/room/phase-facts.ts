/**
 * 阶段事实单一口径（纯函数）。
 *
 * 为什么存在：阶段分类白名单（「是否对局中」「是否可暂停」）曾在 game-service、
 * round-machine 与快照端口实现处各自内联（4 份），改一处漏一处会静默改变
 * 大厅状态展示与暂停守卫的语义（如暂停中的房间在大厅被显示为「房间中」）。
 * 本模块是阶段分类的唯一来源；阶段标称时长仍归 member-facts（ADR-0023）。
 */
import type { RoomPhase } from '@draw-guess/shared'

/**
 * 对局进行中的阶段（含 paused）：「是否已开赛」类判定与大厅玩家状态展示共用。
 * paused 是可恢复的对局暂停态，因此计入进行中；starting 是开局倒计时，尚未正式
 * 开赛但已进入对局上下文（大厅状态、提前结束守卫都依赖它）。
 * 接龙的五个阶段全部属于进行中的对局——漏掉它们会让大厅把接龙房的成员显示成「房间中」
 *（`isInMatchPhase` 是玩家在场状态的唯一口径）。
 */
const IN_MATCH_PHASES = [
  'starting',
  'choosing_word',
  'drawing',
  'round_result',
  'relay_choose',
  'relay_draw',
  'relay_guess',
  'relay_showcase',
  'relay_vote',
] as const satisfies readonly RoomPhase[]

/**
 * 允许进入回合结算的阶段：作画中，或「作画中进入的暂停」。
 * 暂停前阶段是否为 drawing 由调用方另行守卫（暂停也可能发生在选词/结算期）。
 */
const ROUND_SETTLE_PHASES = ['drawing'] as const satisfies readonly RoomPhase[]

/**
 * 接龙动手期（步 1–4 的个人棒次）：选词、作画、猜词。
 * 用途：**本步代交**的准入（relay 状态机）——展示期没有个人棒次，不安排代交
 *（轮播完全自动、不因成员变动而中止，S12）。
 * 断线保席另用 `isRelayMatchPhase`：展示 / 投票期掉线同样保留席位（US48）。
 */
const RELAY_PLAY_PHASES = [
  'relay_choose',
  'relay_draw',
  'relay_guess',
] as const satisfies readonly RoomPhase[]

/**
 * 接龙局进行中的**全部**阶段＝动手期 + 展示期（复盘轮播 / 投票）。
 * 用途：断线保席（session）——展示期掉线同样保留席位与链位，让宽限内重连的人仍能看完整
 * 轮播、并在投票期补投（US48）。它与代交准入 `isRelayPlayPhase` 不同：展示期没有个人棒次，
 * 掉线既不代交、也不影响轮播（S12）。
 */
const RELAY_MATCH_PHASES = [
  ...RELAY_PLAY_PHASES,
  'relay_showcase',
  'relay_vote',
] as const satisfies readonly RoomPhase[]

/** 阶段是否属于进行中的对局（含暂停态）。 */
export function isInMatchPhase(phase: RoomPhase): boolean {
  return IN_MATCH_PHASES.some((candidate) => candidate === phase)
}

/** 阶段是否属于接龙动手期（代交准入）。 */
export function isRelayPlayPhase(phase: RoomPhase): boolean {
  return RELAY_PLAY_PHASES.some((candidate) => candidate === phase)
}

/** 阶段是否属于「接龙局进行中」（保席口径，含展示 / 投票期）。 */
export function isRelayMatchPhase(phase: RoomPhase): boolean {
  return RELAY_MATCH_PHASES.some((candidate) => candidate === phase)
}

/** 阶段是否允许进入回合结算。 */
export function isRoundSettlePhase(phase: RoomPhase): boolean {
  return ROUND_SETTLE_PHASES.some((candidate) => candidate === phase)
}
