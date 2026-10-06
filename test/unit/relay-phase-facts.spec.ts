import { describe, expect, it } from 'vitest'
import type { RoomPhase } from '@draw-guess/shared'
import {
  isInMatchPhase,
  isRoundSettlePhase,
} from '../../apps/server/src/domain/room/phase-facts.ts'

/**
 * 阶段事实谓词的接龙维度（S62）。
 *
 * `isInMatchPhase` 是新阶段最容易漏的落点：它同时决定大厅玩家状态展示与「是否对局进行中」
 * 类守卫（提前结束、断线保席），漏掉接龙阶段会让接龙房在大厅被显示成「房间中」。
 * 断线保席与经典共用这一口径（session 另有 `game_result` 一条边），因此不再单列接龙专属谓词。
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
