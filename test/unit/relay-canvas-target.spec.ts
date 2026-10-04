/**
 * 接龙绘图目标解析（S9 / S53）。
 *
 * 「观看者 + 步骤 id → 本棒链的画布」是纯逻辑：链按开局席位顺序排列，链 j 的第 s 棒作画者
 * 是链 (j + s - 1) 的发起人（环状顺延），因此观看者本棒的链是「以他为发起人的链」向前回退
 * (s - 1) 条。用例里的链序号全部是手算样例（4 / 5 / 6 人各覆盖一次），
 * 不用被测实现复算；协议错误码映射与房间副作用归 GameService，由 relay-canvas-path 覆盖。
 */
import { describe, expect, it } from 'vitest'
import type { RelayStep } from '@draw-guess/shared'
import {
  resolveRelayCanvasTarget,
  type RelayCanvasDecision,
  type RelayCanvasSource,
} from '../../apps/server/src/domain/relay/relay-canvas-target.ts'
import {
  createRelayChainSecret,
  type RelayGameSecret,
} from '../../apps/server/src/domain/relay/relay-models.ts'

const CURRENT_STEP_ID = '00000000-0000-4000-8000-0000000000a1'

/** 手算用的假局：链顺序 = 席位顺序，链 i 的发起人是 p{i}（与开局口径一致）。 */
function relayGame(playerCount: number, currentStep: RelayStep): RelayGameSecret {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    startedAt: 0,
    currentStep,
    stepId: CURRENT_STEP_ID,
    phaseStartedAt: 0,
    phaseEndsAt: 0,
    chains: Array.from({ length: playerCount }, (_, index) => createRelayChainSecret(`p${index}`)),
    stepSubmissions: new Set<string>(),
    autoSubmitTimers: new Map(),
    messages: [],
  }
}

/** 作画阶段（步 1/3 的 `relay_draw`）：解析目标只在作画棒成立。 */
function drawingSource(relay: RelayGameSecret): RelayCanvasSource {
  return { phase: 'relay_draw', relay }
}

/** 取出被接受的解析结果；拒绝时直接失败（接受分支的用例只关心目标是谁的画布）。 */
function accepted(decision: RelayCanvasDecision) {
  if (!decision.accepted) throw new Error(`解析应被接受，实际拒绝：${decision.reason}`)
  return decision.value
}

describe('接龙绘图目标解析', () => {
  it('步 1：每个玩家都解析到「以自己为发起人」的那条链的第一幅画布', () => {
    const relay = relayGame(4, 1)
    for (const index of [0, 1, 2, 3]) {
      const target = accepted(
        resolveRelayCanvasTarget(drawingSource(relay), `p${index}`, CURRENT_STEP_ID),
      )
      expect(target.step).toBe(1)
      expect(target.chain).toBe(relay.chains[index])
      expect(target.canvas).toBe(relay.chains[index]?.step1Canvas)
    }
  })

  it('步 3（4 人环）：player k 画链 (k - 2) mod 4 的第二幅画布', () => {
    const relay = relayGame(4, 3)
    // 手算：p0→链 2、p1→链 3、p2→链 0、p3→链 1（链 j 的第 3 棒 = 链 (j + 2) mod 4 的发起人）。
    const expectedChainIndex: Record<string, number> = { p0: 2, p1: 3, p2: 0, p3: 1 }
    for (const [playerId, chainIndex] of Object.entries(expectedChainIndex)) {
      const target = accepted(
        resolveRelayCanvasTarget(drawingSource(relay), playerId, CURRENT_STEP_ID),
      )
      expect(target.chain).toBe(relay.chains[chainIndex])
      expect(target.canvas).toBe(relay.chains[chainIndex]?.step3Canvas)
    }
  })

  it('步 3（5 人与 6 人环）：解析结果与手算的链序号一致', () => {
    // 5 人：p4 → 链 (4 - 2) mod 5 = 2（链 2 的第 3 棒 = 链 (2 + 2) mod 5 的发起人 = p4）。
    const five = relayGame(5, 3)
    const fiveTarget = accepted(
      resolveRelayCanvasTarget(drawingSource(five), 'p4', CURRENT_STEP_ID),
    )
    expect(fiveTarget.chain).toBe(five.chains[2])
    // 6 人：p5 → 链 (5 - 2) mod 6 = 3（链 3 的第 3 棒 = 链 (3 + 2) mod 6 的发起人 = p5）。
    const six = relayGame(6, 3)
    const sixTarget = accepted(resolveRelayCanvasTarget(drawingSource(six), 'p5', CURRENT_STEP_ID))
    expect(sixTarget.chain).toBe(six.chains[3])
  })

  it('步骤 id 与当前步不符按旧包拒绝，且优先于阶段与越权判定', () => {
    const relay = relayGame(4, 1)
    const staleId = '00000000-0000-4000-8000-0000000000c1'
    expect(resolveRelayCanvasTarget(drawingSource(relay), 'p0', staleId)).toEqual({
      accepted: false,
      reason: 'stale-step',
    })
    expect(resolveRelayCanvasTarget({ phase: 'relay_guess', relay }, 'p0', staleId)).toEqual({
      accepted: false,
      reason: 'stale-step',
    })
    expect(resolveRelayCanvasTarget(drawingSource(relay), 'outsider', staleId)).toEqual({
      accepted: false,
      reason: 'stale-step',
    })
  })

  it('非作画棒（猜词 / 选词 / 复盘）一律拒绝：作画只发生在 relay_draw 的步 1 与步 3', () => {
    const guess = { phase: 'relay_guess', relay: relayGame(4, 2) } satisfies RelayCanvasSource
    expect(resolveRelayCanvasTarget(guess, 'p0', CURRENT_STEP_ID)).toEqual({
      accepted: false,
      reason: 'not-drawing-step',
    })
    const choosing = { phase: 'relay_choose', relay: relayGame(4, 1) } satisfies RelayCanvasSource
    expect(resolveRelayCanvasTarget(choosing, 'p0', CURRENT_STEP_ID)).toEqual({
      accepted: false,
      reason: 'not-drawing-step',
    })
    const showcase = { phase: 'relay_showcase', relay: relayGame(4, 4) } satisfies RelayCanvasSource
    expect(resolveRelayCanvasTarget(showcase, 'p0', CURRENT_STEP_ID)).toEqual({
      accepted: false,
      reason: 'not-drawing-step',
    })
    // 阶段与步骤号打架（状态机不应产生，但解析必须自证）：仍按「不是作画棒」拒绝。
    const inconsistent: RelayCanvasSource = { phase: 'relay_draw', relay: relayGame(4, 2) }
    expect(resolveRelayCanvasTarget(inconsistent, 'p0', CURRENT_STEP_ID)).toEqual({
      accepted: false,
      reason: 'not-drawing-step',
    })
  })

  it('不在本局链阵容中的观看者被拒（越权），画布永不外泄', () => {
    const relay = relayGame(4, 1)
    expect(resolveRelayCanvasTarget(drawingSource(relay), 'latecomer', CURRENT_STEP_ID)).toEqual({
      accepted: false,
      reason: 'not-participant',
    })
  })
})
