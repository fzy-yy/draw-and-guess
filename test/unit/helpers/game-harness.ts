/**
 * 服务端测试脚手架：经 `createBackend` 构造**生产同一个世界**，再用假 io 与假连接驱动它。
 *
 * 历史：这里曾装配 `GameService`（一套与生产并行的用例层），于是单测跨的接缝与生产不是同一条。
 * 迁移完成后只保留 `backend`——测试与生产共用装配函数（docs/adr/0064-single-backend-assembly.md）。
 */
import { APP_CONFIG } from '../../../apps/server/src/config/index.ts'
import type { RoomSettings } from '@draw-guess/shared'
import { defaultRoomSettings } from '@draw-guess/config'
import { createBackend, type Backend } from '../../../apps/server/src/backend.ts'
import { SILENT_LOGGER, type RuntimeLogger } from '../../../apps/server/src/errors.ts'
import type { AppServer } from '../../../apps/server/src/socket-types.ts'
import type { RuntimeDependencies } from '../../../apps/server/src/runtime.ts'
import type { VocabularyRegistry } from '../../../apps/server/src/vocabulary/index.ts'
import { createMemoryRepositories } from './in-memory-repositories.ts'
import { createMemoryVocabularyRegistry } from './mini-vocabulary.ts'
import { createFakeRuntime, type FakeRuntime } from './fake-clock.ts'
import type { RegisterSocket } from './backend-harness.ts'

export interface RecordedEvent {
  target: string
  event: string
  payload: unknown
}

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

export interface GameHarness {
  /** 生产装配的世界：测试直接经它驱动领域，与生产跨同一条接缝。 */
  backend: Backend
  runtime: FakeRuntime
  repositories: ReturnType<typeof createMemoryRepositories>
  ioEvents: RecordedEvent[]
  createSocket(id: string): TestSocket
  register(
    nickname: string,
    socketId?: string,
    recoveryToken?: string,
  ): {
    playerId: string
    recoveryToken: string
    socket: TestSocket
  }
}

export function createGameHarness(
  options: {
    runtime?: FakeRuntime
    repositories?: ReturnType<typeof createMemoryRepositories>
    /** 注入自定义词库注册表（如低于开局裁决线的小词库），默认使用标准内存词库。 */
    vocabulary?: VocabularyRegistry
    /** 注入记录型日志器即可断言「失败必须落白名单日志」；默认静默。 */
    logger?: RuntimeLogger
  } = {},
): GameHarness {
  const runtime = options.runtime ?? createFakeRuntime()
  const repositories = options.repositories ?? createMemoryRepositories()
  const ioEvents: RecordedEvent[] = []
  const io = {
    to: (target: string) => {
      const broadcast = {
        emit: (event: string, payload: unknown) => ioEvents.push({ target, event, payload }),
      }
      // 排除广播（`emitRoomEventExcept`）：被排除的连接由调用方给定，测试仍把事件记到同一房间，
      // 断言口径是「房间里发出了什么」，不模拟 Socket.IO 的投递过滤。
      return { ...broadcast, except: (_socketId: string) => broadcast }
    },
    in: (target: string) => ({
      emit: (event: string, payload: unknown) => ioEvents.push({ target, event, payload }),
    }),
    emit: (event: string, payload: unknown) => ioEvents.push({ target: '*', event, payload }),
  } as unknown as AppServer

  const backend = createBackend({
    io,
    vocabulary: options.vocabulary ?? createMemoryVocabularyRegistry(),
    repositories,
    logger: options.logger ?? SILENT_LOGGER,
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
        emit: (event, payload) => ioEvents.push({ target, event, payload }),
      }),
    }
    return socket
  }

  let socketSequence = 0
  return {
    backend,
    runtime,
    repositories,
    ioEvents,
    createSocket,
    register: (nickname, socketId, recoveryToken) => {
      socketSequence += 1
      const socket = createSocket(socketId ?? `socket-${socketSequence}`)
      const registration = backend.session.register(socket as unknown as RegisterSocket, {
        protocolVersion: APP_CONFIG.app.protocolVersion,
        profile: { nickname, avatarId: '01' },
        preferences: { discoverable: true, acceptsInvites: true },
        ...(recoveryToken ? { recoveryToken } : {}),
      })
      return {
        playerId: registration.player.id,
        recoveryToken: registration.recoveryToken,
        socket,
      }
    },
  }
}

export function testRoomSettings(patch: Partial<RoomSettings> = {}): RoomSettings {
  // 默认规则唯一来源就是公开配置的 defaultRoomSettings；测试不再经服务端中转工厂。
  return {
    ...defaultRoomSettings(),
    roundsPerPlayer: 1,
    ...patch,
  }
}

export function startTwoPlayerGame(
  harness: GameHarness,
  settings: RoomSettings = testRoomSettings(),
) {
  const host = harness.register('房主')
  const guest = harness.register('客人')
  const room = harness.backend.room.createRoom(host.playerId, {
    name: '测试房间',
    visibility: 'public',
    settings,
  })
  harness.backend.room.joinRoom(guest.playerId, room.id)
  const ready = harness.backend.room.setReady(guest.playerId, true)
  harness.backend.gameplay.startGame(host.playerId, ready.stateVersion)
  harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)
  const secret = harness.backend.rooms.get(room.id)
  if (!secret?.game) throw new Error('对局未启动')
  return { host, guest, room: secret, game: secret.game }
}
