/**
 * 服务端 Socket.IO 类型化别名与 socket.data 契约。
 *
 * 事件方向映射直接复用 shared 协议层（ClientToServerEvents / ServerToClientEvents，
 * 均由 Zod Schema 推导），本文件只补服务端独有的两件事：
 * 1. `AppSocketData`：socket.data 这只「垃圾袋」的全部合法字段——此前各处
 *    `socket.data.xxx as T` 手写还原（14+ 处），现在读写两端都有编译期契约；
 * 2. `AppServer` / `AppSocket`：接入泛型后的 Server/Socket 别名，业务代码统一引用，
 *    不再出现裸 `import('socket.io').Socket`（emit/on/data 全链路失去约束的入口）。
 */
import type { ClientToServerEvents, ServerToClientEvents, Ack } from '@draw-guess/shared'
import type { Server, Socket } from 'socket.io'
import type { RuntimeLogContext } from './errors.ts'
import type { OperationalMetrics } from './observability/metrics.ts'
import type { Clock } from './runtime.ts'

/** 服务端集群内部广播事件表：本项目单进程部署、不使用，置空仅为满足泛型约束。 */
export type InterServerEvents = Record<string, () => void>

/**
 * binder 需要经 socket.data 访问的服务端能力子集（结构化接口）。
 * 刻意不引用 GameService 类本身：models/领域层经 AppSocket 触到本文件时，
 * 不会反向依赖应用服务，避免「领域模型 → GameService → 领域模型」的类型环。
 */
interface SocketServiceAccess {
  readonly clock: Clock
  readonly metrics: OperationalMetrics
  logUnexpectedError(error: unknown, context?: RuntimeLogContext): void
}

/** socket.data 的类型化袋：连接期基础设施状态，全部字段显式声明，禁止任意键写入。 */
export interface AppSocketData {
  /** 当前连接绑定的玩家身份（注册/恢复成功后写入；注销/断线清理后删除）。 */
  playerId?: string
  /**
   * 连接期服务能力（结构即 `socket.data.service`）：binder 经它取限频时钟、运维指标与异常日志。
   * 注册任何 handler 前即写入（server.ts 的 connection 回调），运行期恒存在，故为必选。
   */
  service: SocketServiceAccess
  /**
   * 幂等 ack 缓存（事件名 + requestId → 成功 ack）。
   * 建连时即为连接级 Map；注册/恢复成功时由 SessionService 的会话绑定切换为
   * 玩家级共享引用，使同一玩家换连接后仍能命中旧请求的结果。
   */
  requestCache: Map<string, Ack<unknown>>
  /** 执行中的同 requestId 请求：并发重复请求共享同一个执行 Promise。建连时即创建。 */
  inFlightRequests: Map<string, Promise<Ack<unknown>>>
  /** 每连接一秒滑动窗口限频的时间戳队列（首个限频事件前不存在）。 */
  eventTimes?: number[]
}

/** 接入协议泛型后的 Socket.IO Server 别名。 */
export type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  AppSocketData
>

/** 接入协议泛型后的单连接 Socket 别名。 */
export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  AppSocketData
>
