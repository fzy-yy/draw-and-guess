/**
 * 客户端 Socket 传输装配层：io() 构造与连接/请求/推送装配的唯一入口（ADR-0019）。
 *
 * stores 与组合式函数只经 stores/socket.ts 的窄端口（GameTransportSocket / PushBindingTarget）
 * 触碰连接，真实 io() 实例仅允许在本文件的构造边界断言进入视图；transport 按 Pinia 实例
 * 绑定（installGameTransport / useGameTransport），Store 不读取模块级 Socket 单例。
 */
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
  /**
   * 测试观测接缝（在途请求数/销毁态，供契约测试断言计数跃迁）；生产勿依赖——
   * 生产行为一律以请求返回的 ok / failureKind 判定，不轮询内部状态。
   */
  readonly requestState: Readonly<RequestState>
  attach(handlers: SocketHandlers): () => void
  connect(): void
  disconnect(): void
  /** 测试观测接缝：批量取消在途请求；生产按各请求自身的重试/静默声明收敛，不主动批量取消。 */
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
  // destroyed 只在装配层内部守卫 connect/destroy 的幂等，从不外露、无响应式消费者，
  // 用普通变量即可（此前的 reactive 包装徒增一个 Proxy）。
  let destroyed = false

  return {
    socket,
    request: requester,
    notify: options.notify,
    // requester.state 在请求层已是 readonly() 视图，这里直接透传，不再二次包装。
    requestState: requester.state,
    attach: (handlers) => attachSocketListeners(handlers, socket),
    connect: () => {
      if (!destroyed) socket.connect()
    },
    disconnect: () => socket.disconnect(),
    cancelRequests: () => requester.cancelAll(),
    destroy: () => {
      if (destroyed) return
      destroyed = true
      requester.destroy()
      disposeSocketLifecycle(socket)
    },
  }
}

const transportByPinia = new WeakMap<Pinia, GameTransport>()

/**
 * 将应用唯一 transport 绑定到 Pinia 实例，Store 不再读取模块级 Socket。
 * 纯登记副作用、不回传 pinia：调用方（main.ts 与测试装配）都无需接返回值。
 */
export function installGameTransport(pinia: Pinia, transport: GameTransport): void {
  transportByPinia.set(pinia, transport)
}

export function useGameTransport(): GameTransport {
  const pinia = getActivePinia()
  const transport = pinia && transportByPinia.get(pinia)
  if (!transport) throw new Error('GameTransport 尚未注入当前 Pinia')
  return transport
}
