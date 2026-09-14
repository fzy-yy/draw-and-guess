import { createPinia, type Pinia } from 'pinia'
import type { Ack } from '@draw-guess/shared'
import {
  createGameTransport,
  installGameTransport,
  type GameTransport,
} from '@/application/game-transport'
import type { NotifyFn } from '@/stores/request'

type Listener = (...args: unknown[]) => void
type Responder = (
  event: string,
  payload: Record<string, unknown>,
) => Ack<unknown> | Promise<Ack<unknown>>

function addListener(map: Map<string, Set<Listener>>, event: string, handler: Listener): void {
  const listeners = map.get(event) ?? new Set<Listener>()
  listeners.add(handler)
  map.set(event, listeners)
}

function removeListener(map: Map<string, Set<Listener>>, event: string, handler: Listener): void {
  map.get(event)?.delete(handler)
}

export interface FakeGameTransport {
  transport: GameTransport
  socket: GameTransport['socket']
  requests: Array<{ event: string; payload: Record<string, unknown> }>
  notifications: Array<{ text: string; type?: 'success' | 'warning' | 'error' }>
  setResponder(responder: Responder): void
  emit(event: string, ...args: unknown[]): void
  emitManager(event: string, ...args: unknown[]): void
  listenerCount(event: string): number
  managerListenerCount(event: string): number
  connectCalls(): number
  disconnectCalls(): number
}

export function createFakeGameTransport(): FakeGameTransport {
  const socketListeners = new Map<string, Set<Listener>>()
  const managerListeners = new Map<string, Set<Listener>>()
  const requests: FakeGameTransport['requests'] = []
  const notifications: FakeGameTransport['notifications'] = []
  let connectCallCount = 0
  let disconnectCallCount = 0
  let responder: Responder = (_event, payload) => ({
    ok: true,
    requestId: String(payload.requestId),
    data: undefined,
  })
  const emitFrom = (map: Map<string, Set<Listener>>, event: string, ...args: unknown[]) => {
    for (const listener of [...(map.get(event) ?? [])]) listener(...args)
  }
  const manager = {
    on(event: string, handler: Listener) {
      addListener(managerListeners, event, handler)
      return manager
    },
    off(event: string, handler: Listener) {
      removeListener(managerListeners, event, handler)
      return manager
    },
  }
  const fakeSocket = {
    connected: false,
    io: manager,
    on(event: string, handler: Listener) {
      addListener(socketListeners, event, handler)
      return fakeSocket
    },
    off(event: string, handler: Listener) {
      removeListener(socketListeners, event, handler)
      return fakeSocket
    },
    connect() {
      connectCallCount += 1
      fakeSocket.connected = true
      emitFrom(socketListeners, 'connect')
      return fakeSocket
    },
    disconnect() {
      disconnectCallCount += 1
      fakeSocket.connected = false
      return fakeSocket
    },
    timeout() {
      return fakeSocket
    },
    emitWithAck(event: string, payload: Record<string, unknown>) {
      requests.push({ event, payload })
      return Promise.resolve(responder(event, payload))
    },
  }
  const notify: NotifyFn = (text, type) => notifications.push({ text, type })
  const socket = fakeSocket as unknown as GameTransport['socket']
  const transport = createGameTransport({ socket, notify })

  return {
    transport,
    socket,
    requests,
    notifications,
    setResponder: (next) => (responder = next),
    emit: (event, ...args) => emitFrom(socketListeners, event, ...args),
    emitManager: (event, ...args) => emitFrom(managerListeners, event, ...args),
    listenerCount: (event) => socketListeners.get(event)?.size ?? 0,
    managerListenerCount: (event) => managerListeners.get(event)?.size ?? 0,
    connectCalls: () => connectCallCount,
    disconnectCalls: () => disconnectCallCount,
  }
}

export function createPiniaWithFakeTransport(): {
  pinia: Pinia
  fakeTransport: FakeGameTransport
} {
  const pinia = createPinia()
  const fakeTransport = createFakeGameTransport()
  installGameTransport(pinia, fakeTransport.transport)
  return { pinia, fakeTransport }
}

export function installFakeGameTransport(pinia: Pinia): FakeGameTransport {
  const fakeTransport = createFakeGameTransport()
  installGameTransport(pinia, fakeTransport.transport)
  return fakeTransport
}
