import { reactive, readonly } from 'vue'
import type { Pinia } from 'pinia'
import { getActivePinia } from 'pinia'
import { io } from 'socket.io-client'
import type { SocketHandlers, GameSocket, GameTransportSocket } from '@/stores/socket'
import { attachSocketListeners, disposeSocketLifecycle } from '@/stores/socket'
import { createRequester, type NotifyFn, type Requester, type RequestState } from '@/stores/request'

export interface GameTransport {
  /** 对外只暴露窄视图（绑定/请求端口 + 连接状态与控制）；消费者与替身都不触整个 Socket。 */
  readonly socket: GameTransportSocket
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
  socket?: GameTransportSocket
}): GameTransport {
  // socket.io-client 的 io() 工厂签名不带泛型（返回裸 Socket），只能在构造边界断言一次
  // 为协议化别名；GameSocket → GameTransportSocket 由编译器逐方法验证通过（重载式窄端口
  // 被真实实例结构满足），视图之后全链路无断言。消费方与测试替身都只见窄端口。
  const socket: GameTransportSocket =
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
