/**
 * 生产装配缝上的绘图拒绝码（docs/adr/0064-single-backend-assembly.md）。
 *
 * 这些用例经 `createBackend` 驱动——与生产完全同一个装配函数。
 * 在此之前生产侧的拒绝是裸 `Error`，经 `toAppError` 一律收敛成 INTERNAL_ERROR：
 * 客户端按 STALE_DRAW_EVENT / NOT_DRAWER 重同步的分支永远不触发，错误日志里写满
 * 「未预期的服务器内部错误」。这里钉住「拒绝必须带稳定错误码」。
 */
import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import type { Stroke } from '@draw-guess/shared'
import { createBackendHarness } from './helpers/backend-harness.ts'
import { testRoomSettings } from './helpers/game-harness.ts'

/** 两条玩家身份 + 一个已开局的经典房。 */
function createClassicScenario() {
  const harness = createBackendHarness()
  const backend = harness.backend
  const host = harness.register('房主')
  const guest = harness.register('客人')
  const snapshot = backend.room.createRoom(host.playerId, {
    name: '测试房间',
    visibility: 'public',
    settings: testRoomSettings(),
  })
  backend.room.joinRoom(guest.playerId, snapshot.id)
  const ready = backend.room.setReady(guest.playerId, true)
  backend.gameplay.startGame(host.playerId, ready.stateVersion)
  harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)

  const room = backend.rooms.get(snapshot.id)
  if (!room?.game) throw new Error('对局未启动')
  return { harness, backend, room, game: room.game, host, guest }
}

function stroke(sequence: number): Stroke {
  return {
    kind: 'stroke',
    id: `stroke-${sequence}`,
    tool: 'pen',
    color: '#1F2937',
    width: 5,
    sequence,
    startPointIndex: 0,
    points: [{ x: 0.3, y: 0.3 }],
  }
}

/** 捕获拒绝码；没有抛出时返回 undefined（用例会因此失败）。 */
function rejectionCode(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

/** 进入作画阶段：画家选定第一个候选词。 */
function enterDrawing(scenario: ReturnType<typeof createClassicScenario>): void {
  const candidate = scenario.game.candidates[0]
  if (!candidate) throw new Error('缺少候选词')
  scenario.backend.gameplay.chooseWord(scenario.game.drawerId, scenario.game.roundId, candidate.id)
}

describe('生产装配缝的绘图拒绝码', () => {
  it('非画家在作画阶段提交笔画：NOT_DRAWER，而不是 INTERNAL_ERROR', () => {
    const scenario = createClassicScenario()
    enterDrawing(scenario)
    const game = scenario.game

    const nonDrawer = game.drawerId === scenario.host.playerId ? scenario.guest : scenario.host
    const code = rejectionCode(() =>
      scenario.backend.drawing.classic.addStroke(nonDrawer.playerId, game.roundId, stroke(0)),
    )

    expect(code).toBe('NOT_DRAWER')
    expect(code).not.toBe('INTERNAL_ERROR')
  })

  it('笔画挂到别的回合 id 上：仍是 NOT_DRAWER（不因上下文陈旧而升格为内部错误）', () => {
    const scenario = createClassicScenario()
    enterDrawing(scenario)

    const code = rejectionCode(() =>
      scenario.backend.drawing.classic.addStroke(
        scenario.game.drawerId,
        'stale-round-id',
        stroke(1),
      ),
    )

    expect(code).toBe('NOT_DRAWER')
  })

  it('经典房收到接龙绘图命令：NO_GAME', () => {
    const scenario = createClassicScenario()
    const code = rejectionCode(() =>
      scenario.backend.drawing.relay.addStroke(scenario.host.playerId, 'any-step-id', stroke(0)),
    )

    expect(code).toBe('NO_GAME')
  })
})
