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
import { createBackend, type Backend } from '../../apps/server/src/backend.ts'
import type { AppServer } from '../../apps/server/src/socket-types.ts'
import type { RuntimeDependencies } from '../../apps/server/src/runtime.ts'
import type { Stroke } from '@draw-guess/shared'
import { createFakeRuntime } from './helpers/fake-clock.ts'
import { createMemoryRepositories } from './helpers/in-memory-repositories.ts'
import { createMemoryVocabularyRegistry } from './helpers/mini-vocabulary.ts'
import { testRoomSettings } from './helpers/game-harness.ts'

interface TestSocket {
  id: string
  data: Record<string, unknown>
  rooms: Set<string>
  disconnected: boolean
  emit(event: string, payload: unknown): void
  join(roomId: string): void
  leave(roomId: string): void
  disconnect(force?: boolean): void
  to(roomId: string): { emit(event: string, payload: unknown): void }
}

function createFakeIo(): AppServer {
  const broadcast = () => ({ emit: () => undefined, except: () => broadcast() })
  return {
    to: () => broadcast(),
    in: () => broadcast(),
    emit: () => undefined,
  } as unknown as AppServer
}

function createTestSocket(id: string): TestSocket {
  const socket: TestSocket = {
    id,
    data: {},
    rooms: new Set([id]),
    disconnected: false,
    emit: () => undefined,
    join: (roomId) => void socket.rooms.add(roomId),
    leave: (roomId) => void socket.rooms.delete(roomId),
    disconnect: () => {
      socket.disconnected = true
    },
    to: () => ({ emit: () => undefined }),
  }
  return socket
}

/** 注册所需的连接类型：由生产服务签名推导，避免测试自造 Socket 形状。 */
type RegisterSocket = Parameters<Backend['session']['register']>[0]

/** 两条玩家身份 + 一个已开局的经典房；返回 backend 与关键现场。 */
function createClassicScenario() {
  const runtime = createFakeRuntime()
  const backend = createBackend({
    io: createFakeIo(),
    vocabulary: createMemoryVocabularyRegistry(),
    repositories: createMemoryRepositories(),
    runtime: runtime as unknown as RuntimeDependencies,
  })

  let socketSequence = 0
  const register = (nickname: string) => {
    socketSequence += 1
    const socket = createTestSocket(`socket-${socketSequence}`)
    const identity = backend.session.register(socket as unknown as RegisterSocket, {
      protocolVersion: APP_CONFIG.app.protocolVersion,
      profile: { nickname, avatarId: '01' },
      preferences: { discoverable: true, acceptsInvites: true },
    })
    return { playerId: identity.player.id, socket }
  }

  const host = register('房主')
  const guest = register('客人')
  const snapshot = backend.room.createRoom(host.playerId, {
    name: '测试房间',
    visibility: 'public',
    settings: testRoomSettings(),
  })
  backend.room.joinRoom(guest.playerId, snapshot.id)
  const ready = backend.room.setReady(guest.playerId, true)
  backend.gameplay.startGame(host.playerId, ready.stateVersion)
  runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)

  const room = backend.rooms.get(snapshot.id)
  if (!room?.game) throw new Error('对局未启动')
  return { backend, runtime, room, game: room.game, host, guest }
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

describe('生产装配缝的绘图拒绝码', () => {
  it('非画家在作画阶段提交笔画：NOT_DRAWER，而不是 INTERNAL_ERROR', () => {
    const scenario = createClassicScenario()
    const game = scenario.game
    const candidate = game.candidates[0]
    if (!candidate) throw new Error('缺少候选词')
    scenario.backend.gameplay.chooseWord(game.drawerId, game.roundId, candidate.id)

    const nonDrawer = game.drawerId === scenario.host.playerId ? scenario.guest : scenario.host
    const code = rejectionCode(() =>
      scenario.backend.drawing.classic.addStroke(nonDrawer.playerId, game.roundId, stroke(0)),
    )

    expect(code).toBe('NOT_DRAWER')
    expect(code).not.toBe('INTERNAL_ERROR')
  })

  it('笔画挂到别的回合 id 上：仍是 NOT_DRAWER（不因上下文陈旧而升格为内部错误）', () => {
    const scenario = createClassicScenario()
    const game = scenario.game
    const candidate = game.candidates[0]
    if (!candidate) throw new Error('缺少候选词')
    scenario.backend.gameplay.chooseWord(game.drawerId, game.roundId, candidate.id)

    const code = rejectionCode(() =>
      scenario.backend.drawing.classic.addStroke(game.drawerId, 'stale-round-id', stroke(1)),
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
