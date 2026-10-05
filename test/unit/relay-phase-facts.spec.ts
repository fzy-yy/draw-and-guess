import { describe, expect, it } from 'vitest'
import type { RoomPhase } from '@draw-guess/shared'
import {
  isInMatchPhase,
  isRelayMatchPhase,
  isRelayPlayPhase,
  isRoundSettlePhase,
} from '../../apps/server/src/domain/room/phase-facts.ts'

/**
 * 阶段事实谓词的接龙维度（S19 / S62）。
 *
 * `isInMatchPhase` 是新阶段最容易漏的落点：它同时决定大厅玩家状态展示与「是否对局进行中」
 * 类守卫（提前结束、自动暂停），漏掉接龙阶段会让接龙房在大厅被显示成「房间中」。
 * 接龙禁用暂停（S19）：`isPausablePhase` 对接龙阶段必须为 false，
 * `LEGAL_PHASES` 中也不存在任何指向 `paused` 的接龙边（由 room-phase-transition 用例守护）。
 * 两个接龙谓词口径不同，必须分开守护：
 * - `isRelayPlayPhase`（动手期，选词/作画/猜词）＝「本步代交」的准入（S8）；
 * - `isRelayMatchPhase`（接龙局进行中，含展示 / 投票期）＝断线保席的准入（US48）：
 *   展示期掉线同样保留席位，宽限内重连才能看完整轮播、在投票窗口内补投；
 *   它仍不安排代交（展示期没有个人棒次）。
 */
const RELAY_PHASES = [
  'relay_choose',
  'relay_draw',
  'relay_guess',
  'relay_showcase',
  'relay_vote',
] as const satisfies readonly RoomPhase[]

describe('接龙阶段事实', () => {
  it('接龙阶段全部属于进行中的对局（大厅不得显示为「房间中」）', () => {
    for (const phase of RELAY_PHASES) {
      expect(isInMatchPhase(phase), phase).toBe(true)
    }
  })

  it('接龙阶段不参与经典回合结算口径', () => {
    for (const phase of RELAY_PHASES) {
      expect(isRoundSettlePhase(phase), phase).toBe(false)
    }
  })

  it('只有动手期（选词/作画/猜词）属于接龙动手期，展示期不算（代交准入）', () => {
    for (const phase of ['relay_choose', 'relay_draw', 'relay_guess'] as const) {
      expect(isRelayPlayPhase(phase), phase).toBe(true)
    }
    // 复盘展示与投票没有个人棒次：不安排代交（轮播完全自动、不因成员变动而中止，S12）
    expect(isRelayPlayPhase('relay_showcase')).toBe(false)
    expect(isRelayPlayPhase('relay_vote')).toBe(false)
    // 经典阶段一律不属于接龙动手期（模式分流不重叠）
    for (const phase of [
      'waiting',
      'starting',
      'choosing_word',
      'drawing',
      'round_result',
      'game_result',
      'closed',
    ] as const) {
      expect(isRelayPlayPhase(phase), phase).toBe(false)
    }
  })

  it('接龙局进行中（保席口径）覆盖全部五个接龙阶段，展示 / 投票期同样保席（US48）', () => {
    for (const phase of RELAY_PHASES) {
      expect(isRelayMatchPhase(phase), phase).toBe(true)
    }
    // starting 不算：接龙局尚未正式开赛，开局倒计时里掉线仍走标准离房（不在这里保席）
    expect(isRelayMatchPhase('starting')).toBe(false)
    for (const phase of [
      'waiting',
      'choosing_word',
      'drawing',
      'round_result',
      'game_result',
      'closed',
    ] as const) {
      expect(isRelayMatchPhase(phase), phase).toBe(false)
    }
    // 动手期是它的子集：代交准入必然保席（反之不成立，展示期保席但不代交）
    for (const phase of ['relay_choose', 'relay_draw', 'relay_guess'] as const)
      expect(isRelayMatchPhase(phase) && isRelayPlayPhase(phase), phase).toBe(true)
  })

  it('经典阶段的既有口径不被接龙改动（回归）', () => {
    for (const phase of ['starting', 'choosing_word', 'drawing', 'round_result'] as const) {
      expect(isInMatchPhase(phase), phase).toBe(true)
    }
    expect(isInMatchPhase('waiting')).toBe(false)
    expect(isInMatchPhase('game_result')).toBe(false)
    expect(isInMatchPhase('closed')).toBe(false)
    expect(isRoundSettlePhase('drawing')).toBe(true)
  })
})
