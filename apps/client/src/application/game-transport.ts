import { reactive, readonly } from 'vue'
import type { Pinia } from 'pinia'
import { getActivePinia } from 'pinia'
import { io } from 'socket.io-client'
import type { SocketHandlers, GameSocket } from '@/stores/socket'
import { attachSocketListeners, disposeSocketLifecycle } from '@/stores/socket'
import { createRequester, type NotifyFn, type Requester, type RequestState } from '@/stores/request'

export interface GameTransport {
  readonly socket: GameSocket
  readonly request: Requester
  readonly notify: NotifyFn
  readonly requestState: Readonly<RequestState>
  attach(handlers: SocketHandlers): () => void
  connect(): void
  disconnect(): void
  cancelRequests(): void
  destroy(): void
}

export function createGameTransport(options: {
  notify: NotifyFn
  socket?: GameSocket
}): GameTransport {
  // socket.io-client 的 io() 工厂签名不带泛型（返回裸 Socket），只能在构造边界断言一次
  // 为协议化别名；此后全链路（attach/request/emitWithAck/on）都按 GameSocket 受检。
  const socket =
    options.socket ??
    (io({
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
    }) as GameSocket)
  const requester = createRequester({ socket, notify: options.notify })
  const lifecycle = reactive({ destroyed: false })

  return {
    socket,
    request: requester,
    notify: options.notify,
    requestState: readonly(requester.state),
    attach: (handlers) => attachSocketListeners(handlers, socket),
    connect: () => {
      if (!lifecycle.destroyed) socket.connect()
    },
    disconnect: () => socket.disconnect(),
    cancelRequests: () => requester.cancelAll(),
    destroy: () => {
      if (lifecycle.destroyed) return
      lifecycle.destroyed = true
      requester.destroy()
      disposeSocketLifecycle(socket)
    },
  }
}

const transportByPinia = new WeakMap<Pinia, GameTransport>()

/** 将应用唯一 transport 绑定到 Pinia 实例，Store 不再读取模块级 Socket。 */
export function installGameTransport(pinia: Pinia, transport: GameTransport): Pinia {
  transportByPinia.set(pinia, transport)
  return pinia
}

export function useGameTransport(): GameTransport {
  const pinia = getActivePinia()
  const transport = pinia && transportByPinia.get(pinia)
  if (!transport) throw new Error('GameTransport 尚未注入当前 Pinia')
  return transport
}
