/**
 * Socket 窄端口类型与推送事件的绑定/解绑函数。
 * io() 构造在 application/game-transport.ts（ADR-0019）；本文件不含连接单例，
 * 监听器注册表只认 PushBindingTarget 端口——store 解耦，测试替身可直接实现该面。
 */
import type { Socket } from 'socket.io-client'
import {
  SERVER_PUSH_EVENT_NAMES,
  type ClientToServerEvents,
  type ServerPushData,
  type ServerPushEventName,
  type ServerToClientEvents,
} from '@draw-guess/shared'
import { decodeServerPush, type InvalidPushReason } from './push-protocol.ts'
import type { RequestAckTransport } from './request.ts'

/**
 * 客户端全链路统一的游戏 Socket 别名（生产适配层用）：
 * 监听方向（服务端推送）与发送方向（客户端请求）都接入 shared 协议泛型——
 * 事件名拼写、payload 形状获得编译期校验；但**入站数据仍按 unknown 走 Zod 解码**
 * （不信任线路数据、防协议版本漂移的安全姿态不变），handler 形参保持 `raw: unknown`
 * 即可（unknown 参数可承接任意事件签名，逆变兼容）。
 */
export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

/**
 * 推送监听端口：attachSocketListeners / disposeSocketLifecycle 只认这个面。
 *
 * 真实 GameSocket 结构上满足它；测试替身直接实现本接口即可，无需 `as never` 伪装整个
 * socket.io 实例。listener 形参写成 `(payload: never) => void`：端口只接收装配层自己
 * 构造的闭包（它们能承接任意载荷），方法双变性同时放过真实 Socket 的类型化监听器签名。
 */
export interface PushBindingTarget {
  readonly io: {
    /** Manager 通道事件：不在 socket 事件命名空间内，socket.off 对其无效。 */
    on(event: 'reconnect_attempt', listener: (attempt: number) => void): void
    on(event: 'error', listener: (error: Error) => void): void
    off(event: 'reconnect_attempt', listener: (attempt: number) => void): void
    off(event: 'error', listener: (error: Error) => void): void
  }
  /**
   * Socket 层绑定面：推送事件按事件名与载荷精确配对（ServerToClientEvents），系统事件
   * connect/disconnect 用真实签名。监听器永远来自装配层闭包（内部把 unknown 载荷送进
   * Zod 解码），替身实现时同样逐事件收窄即可，不需要伪装整个 socket.io 实例。
   */
  on(event: 'connect', listener: () => void): void
  on(event: 'disconnect', listener: (reason: string) => void): void
  on<E extends ServerPushEventName>(event: E, listener: ServerToClientEvents[E]): void
  off(event: 'connect', listener: () => void): void
  off(event: 'disconnect', listener: (reason: string) => void): void
  off<E extends ServerPushEventName>(event: E, listener: ServerToClientEvents[E]): void
}

/**
 * transport.socket 对外暴露面：绑定端口 + 请求端口 + 连接状态/控制。
 * 消费者（session/useAppBootstrap/request/fakes）只经此视图触碰 Socket；
 * io() 的真实实例是唯一允许断言进该视图的边界（见 game-transport.ts）。
 */
export interface GameTransportSocket extends PushBindingTarget, RequestAckTransport {
  readonly connected: boolean
  connect(): void
  disconnect(): void
}

/**
 * 推送恢复通道：非法载荷到达后走哪条权威入口自愈（ADR-0020）。
 * 门禁域知识不再以 roomScoped 数组形态散在装配层——每个事件在注册表里显式声明策略，
 * 新增事件漏声明直接编译失败；旧「删数组条目 → 静默退化为裸 resync」的路径被类型封死。
 */
export type PushRecovery =
  'room-snapshot' | 'presence-refresh' | 'room-list-refresh' | 'generic-resync'

/** 推送注册表单条：解码后的载荷透传回调 + 非法载荷恢复策略。 */
export interface PushBinding<E extends ServerPushEventName> {
  /** 收到的即 `SERVER_PUSH_SCHEMAS[event]` 解出的 data 整体；字段解构归消费方。 */
  on(data: ServerPushData<E>): void
  recovery: PushRecovery
}

/**
 * 客户端推送单注册表类型：协议每个事件都强制配齐 { on, recovery }。
 * 事件清单由 shared 的 SERVER_PUSH_SCHEMAS 派生（SERVER_PUSH_EVENT_NAMES），
 * 注册/解绑由 attachSocketListeners 循环派生——协议层之外不再有第二份事件列表。
 */
export type PushHandlerMap = { [E in ServerPushEventName]: PushBinding<E> }

/** 服务端事件到 store 的回调集合：连接生命周期 + 非法推送上报 + 推送注册表。 */
export interface SocketHandlers {
  onConnect(): void
  onDisconnect(reason: string): void
  onReconnectAttempt(): void
  onIoError(): void
  /** 解码失败的推送先报这里（protocol_mismatch 由装配层短路）；恢复策略查注册表。 */
  onInvalidPush(event: ServerPushEventName, reason: InvalidPushReason): void
  push: PushHandlerMap
}

const activeDetachers = new WeakMap<PushBindingTarget, Set<() => void>>()

/**
 * 绑定单个推送事件：先走 Zod 解码（不信任线路数据），成功则把载荷整体交给注册表项。
 * 函数体保持泛型 `E`：`handlers.push[event]` 经泛型键索引得到 `PushBinding<E>`，
 * 解码结果也是 `ServerPushData<E>`——事件与载荷的配对由编译器逐键锁定，全程零断言。
 */
function bindPushEvent<E extends ServerPushEventName>(
  event: E,
  handlers: SocketHandlers,
  targetSocket: PushBindingTarget,
): () => void {
  const listener = (raw: unknown): void => {
    const result = decodeServerPush(event, raw)
    if (!result.ok) {
      handlers.onInvalidPush(event, result.reason)
      return
    }
    handlers.push[event].on(result.data)
  }
  targetSocket.on(event, listener)
  return () => targetSocket.off(event, listener)
}

/**
 * 注册全部服务端事件监听（全局唯一的连接生命周期）。
 *
 * 生命周期事件（connect/disconnect/Manager 通道）与协议无关，保持显式绑定；
 * 11 个推送事件的注册闭包、注册与解绑清单全部由 `SERVER_PUSH_EVENT_NAMES` 派生
 * （ADR-0020 单注册表）——新增协议事件只需登记注册表条目，此处零改动。
 */
export function attachSocketListeners(
  handlers: SocketHandlers,
  targetSocket: PushBindingTarget,
): () => void {
  const onConnect = () => handlers.onConnect()
  const onDisconnect = (reason: string) => handlers.onDisconnect(reason)
  const onReconnectAttempt = () => handlers.onReconnectAttempt()
  const onIoError = () => handlers.onIoError()
  targetSocket.on('connect', onConnect)
  targetSocket.on('disconnect', onDisconnect)
  targetSocket.io.on('reconnect_attempt', onReconnectAttempt)
  targetSocket.io.on('error', onIoError)
  const detachPushEvents = SERVER_PUSH_EVENT_NAMES.map((event) =>
    bindPushEvent(event, handlers, targetSocket),
  )

  /**
   * 返回解绑函数：开发态 HMR 或 store 销毁时调用，避免同一事件被重复注册
   * （否则会出现 invites 双推、drawingRevision 双增、多个探测定时器）。
   * 除了解绑 socket 级事件，还需解绑挂在 Manager（socket.io）上的 reconnect_attempt / error 监听——
   * 它们不在 socket 事件命名空间内，`socket.off` 对其无效；不清理会让 HMR 反复热更时在
   * Manager 上不断累积监听，导致 onReconnectAttempt/onIoError 被重复触发。
   * 这里不动 socket.io 内部重连/心跳机制本身。
   */
  let attached = true
  const detach = () => {
    if (!attached) return
    attached = false
    targetSocket.io.off('reconnect_attempt', onReconnectAttempt)
    targetSocket.io.off('error', onIoError)
    targetSocket.off('connect', onConnect)
    targetSocket.off('disconnect', onDisconnect)
    for (const off of detachPushEvents) off()
    activeDetachers.get(targetSocket)?.delete(detach)
  }
  const detachers = activeDetachers.get(targetSocket) ?? new Set<() => void>()
  detachers.add(detach)
  activeDetachers.set(targetSocket, detachers)
  return detach
}

/** HMR 与应用销毁共用：精确移除本模块注册项，不触碰其它订阅者的同名事件。 */
export function disposeSocketLifecycle(targetSocket: GameTransportSocket): void {
  for (const detach of [...(activeDetachers.get(targetSocket) ?? [])]) detach()
  activeDetachers.delete(targetSocket)
  targetSocket.disconnect()
}
