/**
 * Socket 连接单例与其推送事件绑定。
 * 与 store 解耦：监听器通过回调接口桥接回 store 状态，便于独立测试与复用。
 */
import { io, type Socket } from 'socket.io-client'
import {
  EVENTS,
  type FillCommand,
  type Invite,
  type MemberConnectionChange,
  type PresenceSnapshot,
  type PublicRoom,
  type RoomSnapshot,
  type Stroke,
} from '@draw-guess/shared'
import { decodeServerPush } from './push-protocol.ts'
import type { DrawingIncrementMeta } from './snapshot-gate.ts'

/** 服务端推送事件到 store 的回调集合。 */
export interface SocketHandlers {
  onConnect(): void
  onDisconnect(reason: string): void
  onReconnectAttempt(): void
  onIoError(): void
  onPresence(snapshot: PresenceSnapshot): void
  onRooms(rooms: PublicRoom[]): void
  onRoomSnapshot(snapshot: RoomSnapshot): void
  onMemberConnectionChanged(change: MemberConnectionChange): void
  onInviteReceived(invite: Invite): void
  onInviteResolved(id: string): void
  onRoomClosed(reason: string): void
  onSystemNotice(text: string): void
  onSystemError(message: string): void
  onInvalidPush(event: string): void
  onDrawStrokeBatch(meta: DrawingIncrementMeta, stroke: Stroke): void
  onDrawFillCommit(meta: DrawingIncrementMeta, fill: FillCommand): void
}

function decoded<T>(
  event: Parameters<typeof decodeServerPush>[0],
  raw: unknown,
  handlers: SocketHandlers,
): T | undefined {
  const result = decodeServerPush(event, raw)
  if (!result.ok) {
    handlers.onInvalidPush(event)
    return undefined
  }
  return result.data as T
}

/** Socket 实例放在模块级，避免 Pinia devtools 序列化传输对象和监听器。 */
export const socket: Socket = io({
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
})

// 开发模式 HMR 热替换时关闭旧 socket，避免残留连接叠加（生产构建无影响）
if (import.meta.hot) {
  import.meta.hot.dispose(() => socket.close())
}

/**
 * 注册全部服务端推送事件监听（全局唯一的连接生命周期）。
 * 注意：绘图增量事件按回合 ID 与序号直接合并进本地历史，无需等待下一次快照。
 */
export function attachSocketListeners(handlers: SocketHandlers): () => void {
  socket.on('connect', () => handlers.onConnect())
  socket.on('disconnect', (reason) => handlers.onDisconnect(reason))
  socket.io.on('reconnect_attempt', () => handlers.onReconnectAttempt())
  socket.io.on('error', () => handlers.onIoError())
  socket.on(EVENTS.presenceSnapshot, (raw: unknown) => {
    const snapshot = decoded<PresenceSnapshot>(EVENTS.presenceSnapshot, raw, handlers)
    if (snapshot) handlers.onPresence(snapshot)
  })
  socket.on(EVENTS.roomListChanged, (raw: unknown) => {
    const rooms = decoded<PublicRoom[]>(EVENTS.roomListChanged, raw, handlers)
    if (rooms) handlers.onRooms(rooms)
  })
  socket.on(EVENTS.roomSnapshot, (raw: unknown) => {
    const snapshot = decoded<RoomSnapshot>(EVENTS.roomSnapshot, raw, handlers)
    if (snapshot) handlers.onRoomSnapshot(snapshot)
  })
  socket.on(EVENTS.roomMemberConnectionChanged, (raw: unknown) => {
    const change = decoded<MemberConnectionChange>(
      EVENTS.roomMemberConnectionChanged,
      raw,
      handlers,
    )
    if (change) handlers.onMemberConnectionChanged(change)
  })
  socket.on(EVENTS.inviteReceived, (raw: unknown) => {
    const invite = decoded<Invite>(EVENTS.inviteReceived, raw, handlers)
    if (invite) handlers.onInviteReceived(invite)
  })
  socket.on(EVENTS.inviteResolved, (raw: unknown) => {
    const payload = decoded<{ id: string }>(EVENTS.inviteResolved, raw, handlers)
    if (payload) handlers.onInviteResolved(payload.id)
  })
  socket.on(EVENTS.roomClosed, (raw: unknown) => {
    const payload = decoded<{ reason: string }>(EVENTS.roomClosed, raw, handlers)
    if (payload) handlers.onRoomClosed(payload.reason)
  })
  socket.on(EVENTS.systemNotice, (raw: unknown) => {
    const payload = decoded<{ text: string }>(EVENTS.systemNotice, raw, handlers)
    if (payload) handlers.onSystemNotice(payload.text)
  })
  socket.on(EVENTS.systemError, (raw: unknown) => {
    const payload = decoded<{ text: string }>(EVENTS.systemError, raw, handlers)
    if (payload) handlers.onSystemError(payload.text)
  })
  socket.on(EVENTS.drawStrokeBatch, (raw: unknown) => {
    const payload = decoded<DrawingIncrementMeta & { stroke: Stroke }>(
      EVENTS.drawStrokeBatch,
      raw,
      handlers,
    )
    if (payload) handlers.onDrawStrokeBatch(payload, payload.stroke)
  })
  socket.on(EVENTS.drawFillCommit, (raw: unknown) => {
    const payload = decoded<DrawingIncrementMeta & { fill: FillCommand }>(
      EVENTS.drawFillCommit,
      raw,
      handlers,
    )
    if (payload) handlers.onDrawFillCommit(payload, payload.fill)
  })

  /**
   * 返回解绑函数：开发态 HMR 或 store 销毁时调用，避免同一事件被重复注册
   * （否则会出现 invites 双推、drawRevision 双增、多个探测定时器）。
   * 除了解绑 socket 级事件，还需解绑挂在 Manager（socket.io）上的 reconnect_attempt / error 监听——
   * 它们不在 socket 事件命名空间内，`socket.off` 对其无效；不清理会让 HMR 反复热更时在
   * Manager 上不断累积监听，导致 onReconnectAttempt/onIoError 被重复触发。
   * 这里不动 socket.io 内部重连/心跳机制本身。
   */
  return () => {
    socket.io.off('reconnect_attempt')
    socket.io.off('error')
    for (const event of [
      'connect',
      'disconnect',
      EVENTS.presenceSnapshot,
      EVENTS.roomListChanged,
      EVENTS.roomSnapshot,
      EVENTS.roomMemberConnectionChanged,
      EVENTS.inviteReceived,
      EVENTS.inviteResolved,
      EVENTS.roomClosed,
      EVENTS.systemNotice,
      EVENTS.systemError,
      EVENTS.drawStrokeBatch,
      EVENTS.drawFillCommit,
    ])
      socket.off(event)
  }
}
