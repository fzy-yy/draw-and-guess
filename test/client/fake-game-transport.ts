import { createPinia, type Pinia } from 'pinia'
import type { Ack } from '@draw-guess/shared'
import {
  createGameTransport,
  installGameTransport,
  type GameTransport,
} from '@/application/game-transport'
import type { GameTransportSocket } from '@/stores/socket'
import type { NotifyFn } from '@/stores/request'

type Listener = (...args: never[]) => void
/** 假替身的唯一 cast：派发端把宽松载荷喂给 never 形参的已注册监听器（never 是逆变底类型）。 */
function dispatch(listener: Listener, args: unknown[]): void {
  ;(listener as (...args: unknown[]) => void)(...args)
}
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
  requests: Array<{ event: string; payload: Record<string, unknown> }>
  notifications: Array<{ text: string; type?: 'success' | 'warning' | 'error' }>
  setResponder(responder: Responder): void
  emit(event: string, ...args: unknown[]): void
  emitManager(event: string, ...args: unknown[]): void
  listenerCount(event: string): number
  managerListenerCount(event: string): number
  connectCalls(): number
  disconnectCalls(): number
  setConnected(value: boolean): void
}

export function createFakeGameTransport(): FakeGameTransport {
  const socketListeners = new Map<string, Set<Listener>>()
  const managerListeners = new Map<string, Set<Listener>>()
  const requests: FakeGameTransport['requests'] = []
  const notifications: FakeGameTransport['notifications'] = []
  let connectCallCount = 0
  let disconnectCallCount = 0
  let connected = false
  let responder: Responder = (_event, payload) => ({
    ok: true,
    requestId: String(payload.requestId),
    data: undefined,
  })
  const emitFrom = (map: Map<string, Set<Listener>>, event: string, ...args: unknown[]) => {
    for (const listener of [...(map.get(event) ?? [])]) dispatch(listener, args)
  }
  const manager: GameTransportSocket['io'] = {
    on(event: 'reconnect_attempt' | 'error', handler: Listener) {
      addListener(managerListeners, event, handler)
    },
    off(event: 'reconnect_attempt' | 'error', handler: Listener) {
      removeListener(managerListeners, event, handler)
    },
  }
  // 显式标注 GameTransportSocket（C3 窄视图）：端口成员缺失或多余（如旧的 timeout 化石）
  // 都会在编译期报错，替身不再需要 as unknown as 伪装整个 socket.io 实例。
  // connected 走闭包 getter：端口的 readonly 与替身内部可变互不冲突。
  const socket: GameTransportSocket = {
    get connected() {
      return connected
    },
    io: manager,
    on(event: string, handler: Listener) {
      addListener(socketListeners, event, handler)
    },
    off(event: string, handler: Listener) {
      removeListener(socketListeners, event, handler)
    },
    connect() {
      connectCallCount += 1
      connected = true
      emitFrom(socketListeners, 'connect')
    },
    disconnect() {
      disconnectCallCount += 1
      connected = false
    },
    emitWithAck(event: string, payload: Record<string, unknown>) {
      requests.push({ event, payload })
      return Promise.resolve(responder(event, payload))
    },
  }
  const notify: NotifyFn = (text, type) => notifications.push({ text, type })
  const transport = createGameTransport({ socket, notify })

  return {
    transport,
    requests,
    notifications,
    setResponder: (next) => (responder = next),
    emit: (event, ...args) => emitFrom(socketListeners, event, ...args),
    emitManager: (event, ...args) => emitFrom(managerListeners, event, ...args),
    listenerCount: (event) => socketListeners.get(event)?.size ?? 0,
    managerListenerCount: (event) => managerListeners.get(event)?.size ?? 0,
    connectCalls: () => connectCallCount,
    disconnectCalls: () => disconnectCallCount,
    setConnected: (value) => {
      connected = value
    },
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
