/**
 * 阶段事实单一口径（纯函数）。
 *
 * 为什么存在：阶段分类白名单（「是否对局中」「是否允许进入回合结算」）曾在 game-service、
 * round-machine 与快照端口实现处各自内联（4 份），改一处漏一处会静默改变大厅状态展示
 * 与提前结束守卫的语义（如对局中的房间成员在大厅被显示为「房间中」）。
 * 本模块是阶段分类的唯一来源（见 docs/adr/0040-round-timing-and-phase-facts.md）。
 */
import type { RoomPhase } from '@draw-guess/shared'

/**
 * 对局进行中的阶段：「是否已开赛」类判定与大厅玩家状态展示共用。
 * starting 是开局倒计时，尚未正式开赛但已进入对局上下文（大厅状态、提前结束守卫都依赖它）。
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

/** 允许进入回合结算的阶段：只有作画中（选词弃权走 abandonChoosing，猜词期不结算）。 */
const ROUND_SETTLE_PHASES = ['drawing'] as const satisfies readonly RoomPhase[]

/** 阶段是否属于进行中的对局。 */
export function isInMatchPhase(phase: RoomPhase): boolean {
  return IN_MATCH_PHASES.some((candidate) => candidate === phase)
}

/** 阶段是否允许进入回合结算。 */
export function isRoundSettlePhase(phase: RoomPhase): boolean {
  return ROUND_SETTLE_PHASES.some((candidate) => candidate === phase)
}
