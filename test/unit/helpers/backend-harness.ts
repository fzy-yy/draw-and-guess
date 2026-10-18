/**
 * 生产装配缝的测试脚手架：经 `createBackend` 构造世界，再用假 io 与假连接驱动它。
 *
 * 为什么不用第二套用例层：单测必须跨生产同一个装配函数（docs/adr/0064-single-backend-assembly.md），
 * 否则「测过了」说的就是另一个程序。这里只模拟连接层，不复制任何业务逻辑。
 */
import { APP_CONFIG } from '../../../apps/server/src/config/index.ts'
import { createBackend, type Backend } from '../../../apps/server/src/backend.ts'
import type { AppServer } from '../../../apps/server/src/socket-types.ts'
import type { RuntimeDependencies } from '../../../apps/server/src/runtime.ts'
import type {
  ArchiveRepository,
  PlayerRepository,
} from '../../../apps/server/src/repositories/index.ts'
import type { VocabularyRegistry } from '../../../apps/server/src/vocabulary/index.ts'
import { createFakeRuntime, type FakeRuntime } from './fake-clock.ts'
import { createMemoryRepositories } from './in-memory-repositories.ts'
import { createMemoryVocabularyRegistry } from './mini-vocabulary.ts'

/** 记录到某处的一条出站事件；`target` 为房间 id、`*`（全局广播）或玩家 socket id。 */
export interface RecordedEvent {
  target: string
  event: string
  payload: unknown
}

/** 测试连接：满足 SessionService 用到的 socket 面（emit / join / leave / rooms / data）。 */
export interface TestSocket {
  id: string
  data: Record<string, unknown>
  rooms: Set<string>
  events: RecordedEvent[]
  disconnected: boolean
  emit(event: string, payload: unknown): void
  join(roomId: string): void
  leave(roomId: string): void
  disconnect(force?: boolean): void
  to(roomId: string): { emit(event: string, payload: unknown): void }
}

/** 注册所需的连接类型：由生产签名推导，测试不自己发明 Socket 形状。 */
export type RegisterSocket = Parameters<Backend['session']['register']>[0]

export interface BackendHarness {
  backend: Backend
  runtime: FakeRuntime
  repositories: { players: PlayerRepository; archive: ArchiveRepository }
  /** 房间广播（`io.to(roomId).emit`）。 */
  roomEvents: RecordedEvent[]
  /** 全局广播（`io.emit`）——按隐私口径，邀请解析等事件不应出现在这里。 */
  broadcasts: RecordedEvent[]
  createSocket(id: string): TestSocket
  /** 建一条连接并完成注册；返回玩家 id 与那条连接（可读它收到的事件）。 */
  register(
    nickname: string,
    options?: { socketId?: string; recoveryToken?: string },
  ): {
    playerId: string
    recoveryToken: string
    socket: TestSocket
  }
}

export function createBackendHarness(
  options: {
    runtime?: FakeRuntime
    repositories?: { players: PlayerRepository; archive: ArchiveRepository }
    vocabulary?: VocabularyRegistry
  } = {},
): BackendHarness {
  const runtime = options.runtime ?? createFakeRuntime()
  const repositories = options.repositories ?? createMemoryRepositories()
  const roomEvents: RecordedEvent[] = []
  const broadcasts: RecordedEvent[] = []

  const io = {
    to: (target: string) => {
      const broadcast = {
        emit: (event: string, payload: unknown) => roomEvents.push({ target, event, payload }),
      }
      // 排除广播：测试只断言「房间里发出了什么」，不模拟 Socket.IO 的投递过滤。
      return { ...broadcast, except: () => broadcast }
    },
    in: (target: string) => ({
      emit: (event: string, payload: unknown) => roomEvents.push({ target, event, payload }),
    }),
    emit: (event: string, payload: unknown) => broadcasts.push({ target: '*', event, payload }),
  } as unknown as AppServer

  const backend = createBackend({
    io,
    vocabulary: options.vocabulary ?? createMemoryVocabularyRegistry(),
    repositories,
    runtime: runtime as unknown as RuntimeDependencies,
  })

  function createSocket(id: string): TestSocket {
    const events: RecordedEvent[] = []
    const socket: TestSocket = {
      id,
      data: {},
      rooms: new Set([id]),
      events,
      disconnected: false,
      emit: (event, payload) => events.push({ target: id, event, payload }),
      join: (roomId) => void socket.rooms.add(roomId),
      leave: (roomId) => void socket.rooms.delete(roomId),
      disconnect: () => {
        socket.disconnected = true
      },
      to: (target) => ({
        emit: (event, payload) => roomEvents.push({ target, event, payload }),
      }),
    }
    return socket
  }

  let socketSequence = 0
  return {
    backend,
    runtime,
    repositories,
    roomEvents,
    broadcasts,
    createSocket,
    register: (nickname, registerOptions = {}) => {
      socketSequence += 1
      const socket = createSocket(registerOptions.socketId ?? `socket-${socketSequence}`)
      const identity = backend.session.register(socket as unknown as RegisterSocket, {
        protocolVersion: APP_CONFIG.app.protocolVersion,
        profile: { nickname, avatarId: '01' },
        preferences: { discoverable: true, acceptsInvites: true },
        ...(registerOptions.recoveryToken ? { recoveryToken: registerOptions.recoveryToken } : {}),
      })
      return {
        playerId: identity.player.id,
        recoveryToken: identity.recoveryToken,
        socket,
      }
    },
  }
}
