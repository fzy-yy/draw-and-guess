/**
 * WebSocket 连接层类型契约。
 *
 * 遵循《后端架构规范》R4.6d 与 R4.6f：
 * 1. 严格使用泛型别名（AppServer、AppSocket），杜绝裸用 socket.io；
 * 2. 显式约束 socket.data 字段，禁止作为任意键袋使用。
 */
import type { ClientToServerEvents, ServerToClientEvents, Ack } from '@draw-guess/shared'
import type { Server, Socket } from 'socket.io'
import type { RuntimeLogContext } from '../core/errors.ts'
import type { OperationalMetrics } from '../observability/metrics.ts'
import type { Clock } from '../core/runtime.ts'

/** 集群内部通信事件表（单机部署置空） */
export type InterServerEvents = Record<string, () => void>

/**
 * 处理器包装器所依赖的基础设施窄端口。
 */
export interface SocketServiceAccess {
  readonly clock: Clock
  readonly metrics: OperationalMetrics
  logUnexpectedError(error: unknown, context?: RuntimeLogContext): void
}

/**
 * socket.data 类型化约束定义。
 */
export interface AppSocketData {
  /** 当前连接绑定的玩家 ID */
  playerId?: string
  /** 基础设施能力端口 */
  service: SocketServiceAccess
  /** 幂等 ACK 缓存（事件名 + requestId → 成功 ack） */
  requestCache: Map<string, Ack<unknown>>
  /** 执行中的同 requestId 请求共享 Promise 映射 */
  inFlightRequests: Map<string, Promise<Ack<unknown>>>
  /** 连接级滑动窗口限频时间戳队列 */
  eventTimes?: number[]
}

/** 完整泛型 Socket.IO Server 类型 */
export type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  AppSocketData
>

/** 完整泛型 Socket 实例类型 */
export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  AppSocketData
>
