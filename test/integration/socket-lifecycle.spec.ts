import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import { strings, serverStrings } from '@draw-guess/strings'
import { EVENTS, createServerPush, type RoomSnapshot, type Stroke } from '@draw-guess/shared'
import { useAppBootstrap } from '@/composables/useAppBootstrap'
import { useLobbyStore } from '@/stores/lobby'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { attachSocketListeners, disposeSocketLifecycle, type SocketHandlers } from '@/stores/socket'
import {
  createGameTransport,
  installGameTransport,
  type GameTransport,
} from '@/application/game-transport'

const transport = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const socketListeners = new Map<string, Set<Listener>>()
  const managerListeners = new Map<string, Set<Listener>>()
  const offCalls: Array<{ scope: 'socket' | 'manager'; event: string; handler?: Listener }> = []
  const requests: string[] = []
  let connectCalls = 0
  let disconnectCalls = 0
  let connectListenerCount = 0
  let response: (event: string) => unknown = () => ({ ok: true, data: undefined })

  function add(map: Map<string, Set<Listener>>, event: string, handler: Listener): void {
    const listeners = map.get(event) ?? new Set<Listener>()
    listeners.add(handler)
    map.set(event, listeners)
  }

  function remove(map: Map<string, Set<Listener>>, event: string, handler?: Listener): void {
    if (handler) map.get(event)?.delete(handler)
    else map.delete(event)
  }

  function emit(map: Map<string, Set<Listener>>, event: string, ...args: unknown[]): void {
    for (const handler of [...(map.get(event) ?? [])]) handler(...args)
  }

  const manager = {
    on(event: string, handler: Listener) {
      add(managerListeners, event, handler)
      return manager
    },
    off(event: string, handler?: Listener) {
      offCalls.push({ scope: 'manager', event, handler })
      remove(managerListeners, event, handler)
      return manager
    },
  }
  const socket = {
    connected: false,
    io: manager,
    on(event: string, handler: Listener) {
      add(socketListeners, event, handler)
      return socket
    },
    off(event: string, handler?: Listener) {
      offCalls.push({ scope: 'socket', event, handler })
      remove(socketListeners, event, handler)
      return socket
    },
    connect() {
      connectCalls += 1
      connectListenerCount = socketListeners.get('connect')?.size ?? 0
      socket.connected = true
      emit(socketListeners, 'connect')
      return socket
    },
    disconnect() {
      disconnectCalls += 1
      socket.connected = false
      return socket
    },
    timeout() {
      return socket
    },
    emitWithAck(event: string) {
      requests.push(event)
      return Promise.resolve(response(event))
    },
  }

  return {
    socket,
    offCalls,
    requests,
    emitSocket: (event: string, ...args: unknown[]) => emit(socketListeners, event, ...args),
    emitManager: (event: string, ...args: unknown[]) => emit(managerListeners, event, ...args),
    listenerCount: (event: string) => socketListeners.get(event)?.size ?? 0,
    managerListenerCount: (event: string) => managerListeners.get(event)?.size ?? 0,
    setResponse: (next: (event: string) => unknown) => (response = next),
    connectCalls: () => connectCalls,
    disconnectCalls: () => disconnectCalls,
    connectListenerCount: () => connectListenerCount,
    reset() {
      socketListeners.clear()
      managerListeners.clear()
      offCalls.length = 0
      requests.length = 0
      connectCalls = 0
      disconnectCalls = 0
      connectListenerCount = 0
      response = () => ({ ok: true, data: undefined })
      socket.connected = false
    },
  }
})

const wrappers: VueWrapper[] = []
let pinia: Pinia
let gameTransport: GameTransport

function handlers(): SocketHandlers {
  return {
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onReconnectAttempt: vi.fn(),
    onIoError: vi.fn(),
    onPresence: vi.fn(),
    onRooms: vi.fn(),
    onRoomSnapshot: vi.fn(),
    onMemberConnectionChanged: vi.fn(),
    onInviteReceived: vi.fn(),
    onInviteResolved: vi.fn(),
    onRoomClosed: vi.fn(),
    onSystemNotice: vi.fn(),
    onSystemError: vi.fn(),
    onInvalidPush: vi.fn(),
    onDrawStrokeBatch: vi.fn(),
    onDrawFillCommit: vi.fn(),
  }
}

function mountBootstrap() {
  let bootstrap!: ReturnType<typeof useAppBootstrap>
  const wrapper = mount(
    defineComponent({
      setup() {
        bootstrap = useAppBootstrap(gameTransport)
        return () => h('div')
      },
    }),
    { global: { plugins: [pinia] } },
  )
  wrappers.push(wrapper)
  return bootstrap
}

beforeEach(() => {
  transport.reset()
  pinia = createPinia()
  gameTransport = createGameTransport({ socket: transport.socket as never, notify: vi.fn() })
  installGameTransport(pinia, gameTransport)
  setActivePinia(pinia)
})

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  gameTransport.destroy()
})

describe('Socket 显式连接生命周期', () => {
  it('快速 connect 发生前已经附加全部监听器', () => {
    const bootstrap = mountBootstrap()

    bootstrap.start()

    expect(transport.connectCalls()).toBe(1)
    expect(transport.connectListenerCount()).toBe(1)
    expect(transport.listenerCount(EVENTS.presenceSnapshot)).toBe(1)
    expect(useSessionStore().connected).toBe(true)
  })

  it('start/stop/start 不重复订阅且会重新显式连接', () => {
    const bootstrap = mountBootstrap()
    bootstrap.start()
    bootstrap.start()
    expect(transport.listenerCount(EVENTS.roomSnapshot)).toBe(1)

    bootstrap.stop()
    expect(transport.listenerCount(EVENTS.roomSnapshot)).toBe(0)

    bootstrap.start()
    expect(transport.listenerCount(EVENTS.roomSnapshot)).toBe(1)
    expect(transport.connectCalls()).toBe(2)
    expect(transport.disconnectCalls()).toBe(1)
  })

  it('断线与重连尝试同步更新会话状态且不重复注册监听', () => {
    const bootstrap = mountBootstrap()
    bootstrap.start()
    const session = useSessionStore()
    session.playerId = '00000000-0000-4000-8000-000000000009'

    transport.emitSocket('disconnect', 'transport close')
    expect(session.connected).toBe(false)
    expect(session.sessionState).toBe('disconnected')

    transport.emitManager('reconnect_attempt')
    expect(session.connectionLabel).toBe(strings.connection.reconnecting)
    expect(transport.managerListenerCount('reconnect_attempt')).toBe(1)

    transport.socket.connected = false
    transport.emitManager('error')
    expect(session.connectionLabel).toBe(strings.connection.unstable)

    transport.emitSocket('disconnect', 'io server disconnect')
    expect(session.sessionState).toBe('idle')
    expect(session.page).toBe('profile')
  })

  it('HMR dispose 精确解绑模块订阅并断开旧连接', () => {
    attachSocketListeners(handlers(), transport.socket as never)
    attachSocketListeners(handlers(), transport.socket as never)
    expect(transport.listenerCount(EVENTS.systemNotice)).toBe(2)

    disposeSocketLifecycle(transport.socket as never)

    expect(transport.listenerCount(EVENTS.systemNotice)).toBe(0)
    expect(transport.managerListenerCount('reconnect_attempt')).toBe(0)
    expect(transport.disconnectCalls()).toBe(1)
    expect(transport.offCalls.every(({ handler }) => typeof handler === 'function')).toBe(true)
  })

  it('解绑一个订阅者不会删除其它订阅者或外部同名监听', () => {
    const first = handlers()
    const second = handlers()
    const external = vi.fn()
    transport.socket.on(EVENTS.systemNotice, external)
    const detachFirst = attachSocketListeners(first, transport.socket as never)
    const detachSecond = attachSocketListeners(second, transport.socket as never)

    transport.emitSocket(EVENTS.systemNotice, createServerPush({ text: '第一次通知' }))
    detachFirst()
    transport.emitSocket(EVENTS.systemNotice, createServerPush({ text: '第二次通知' }))

    expect(first.onSystemNotice).toHaveBeenCalledTimes(1)
    expect(second.onSystemNotice).toHaveBeenCalledTimes(2)
    expect(external).toHaveBeenCalledTimes(2)
    detachSecond()
    expect(transport.listenerCount(EVENTS.systemNotice)).toBe(1)
  })
})

describe('非法推送按事件恢复', () => {
  it('无房间时非法 presence 与 roomList 分别调用可重复权威入口', () => {
    const lobbyStore = useLobbyStore()
    const refreshPresence = vi.spyOn(lobbyStore, 'refreshPresence').mockResolvedValue()
    const refreshRooms = vi.spyOn(lobbyStore, 'refreshRooms').mockResolvedValue()
    const bootstrap = mountBootstrap()
    bootstrap.start()

    transport.emitSocket(
      EVENTS.presenceSnapshot,
      createServerPush({ players: 'invalid', rooms: [] }),
    )
    transport.emitSocket(EVENTS.roomListChanged, createServerPush({ rooms: 'invalid' }))

    expect(useRoomStore().room).toBeUndefined()
    expect(refreshPresence).toHaveBeenCalledOnce()
    expect(refreshRooms).toHaveBeenCalledOnce()
  })

  it('协议版本不匹配进入不可绕过状态而不尝试普通数据恢复', () => {
    const lobbyStore = useLobbyStore()
    const refreshPresence = vi.spyOn(lobbyStore, 'refreshPresence').mockResolvedValue()
    const bootstrap = mountBootstrap()
    bootstrap.start()

    transport.emitSocket(EVENTS.presenceSnapshot, {
      protocolVersion: `${APP_CONFIG.app.protocolVersion}-old`,
      data: { players: [], rooms: [] },
    })

    expect(useSessionStore().protocolMismatch).toBe(true)
    expect(refreshPresence).not.toHaveBeenCalled()
  })

  it('绘图 revision 缺口触发一次完整房间快照恢复', () => {
    const roomStore = useRoomStore()
    const requestFullSnapshot = vi.spyOn(roomStore, 'requestFullSnapshot').mockResolvedValue()
    const roomId = '00000000-0000-4000-8000-000000000001'
    const gameId = '00000000-0000-4000-8000-000000000002'
    const roundId = '00000000-0000-4000-8000-000000000003'
    roomStore.room = {
      id: roomId,
      game: { gameId, roundId, drawingRevision: 1 },
    } as RoomSnapshot
    const bootstrap = mountBootstrap()
    bootstrap.start()
    const stroke: Stroke = {
      kind: 'stroke',
      id: '00000000-0000-4000-8000-000000000004',
      tool: 'pen',
      color: '#1F2937',
      width: 5,
      points: [{ x: 0.1, y: 0.1 }],
      sequence: 1,
      startPointIndex: 0,
    }

    transport.emitSocket(
      EVENTS.drawStrokeBatch,
      createServerPush({ roomId, gameId, roundId, drawingRevision: 3, stroke }),
    )

    expect(requestFullSnapshot).toHaveBeenCalledOnce()
  })
})

describe('房间关闭按稳定关闭码分支', () => {
  it('被踢提醒只由 kicked 码触发，展示文案如何变化都不影响业务判定', () => {
    const bootstrap = mountBootstrap()
    bootstrap.start()
    const session = useSessionStore()

    // 文案故意不是被踢文案：业务判定必须只认码。
    transport.emitSocket(
      EVENTS.roomClosed,
      createServerPush({ reason: strings.store.memberLeftGame('某人'), code: 'kicked' }),
    )
    expect(session.kickedNotice).toBe(true)

    session.dismissKickedNotice()
    // 文案故意复用被踢文案：码不是 kicked 时不得误触发被踢提醒。
    transport.emitSocket(
      EVENTS.roomClosed,
      createServerPush({
        reason: serverStrings.notices.kickedReason,
        code: 'room_empty',
      }),
    )
    expect(session.kickedNotice).toBe(false)
  })
})
