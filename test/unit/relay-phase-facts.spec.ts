import { describe, expect, it } from 'vitest'
import type { RoomPhase } from '@draw-guess/shared'
import {
  isInMatchPhase,
  isPausablePhase,
  isRoundSettlePhase,
} from '../../apps/server/src/domain/room/phase-facts.ts'

/**
 * 阶段事实谓词的接龙维度（S19 / S62）。
 *
 * `isInMatchPhase` 是新阶段最容易漏的落点：它同时决定大厅玩家状态展示与「是否对局进行中」
 * 类守卫（提前结束、自动暂停），漏掉接龙阶段会让接龙房在大厅被显示成「房间中」。
 * 接龙禁用暂停（S19）：`isPausablePhase` 对接龙阶段必须为 false，
 * `LEGAL_PHASES` 中也不存在任何指向 `paused` 的接龙边（由 room-phase-transition 用例守护）。
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

  it('接龙阶段不可暂停，也不参与经典回合结算口径', () => {
    for (const phase of RELAY_PHASES) {
      expect(isPausablePhase(phase), phase).toBe(false)
      expect(isRoundSettlePhase(phase), phase).toBe(false)
    }
  })

  it('经典阶段的既有口径不被接龙改动（回归）', () => {
    for (const phase of [
      'starting',
      'choosing_word',
      'drawing',
      'round_result',
      'paused',
    ] as const) {
      expect(isInMatchPhase(phase), phase).toBe(true)
    }
    expect(isInMatchPhase('waiting')).toBe(false)
    expect(isInMatchPhase('game_result')).toBe(false)
    expect(isInMatchPhase('closed')).toBe(false)
    for (const phase of ['choosing_word', 'drawing', 'round_result'] as const) {
      expect(isPausablePhase(phase), phase).toBe(true)
    }
    expect(isPausablePhase('starting')).toBe(false)
    expect(isRoundSettlePhase('drawing')).toBe(true)
    expect(isRoundSettlePhase('paused')).toBe(true)
  })
})
