/**
 * Socket 连接单例与其推送事件绑定。
 * 与 store 解耦：监听器通过回调接口桥接回 store 状态，便于独立测试与复用。
 */
import type { Socket } from 'socket.io-client'
import {
  EVENTS,
  type FillCommand,
  type Invite,
  type MemberConnectionChange,
  type PresenceSnapshot,
  type PublicRoom,
  type RoomSnapshot,
  type ServerPushData,
  type ServerPushEventName,
  type Stroke,
} from '@draw-guess/shared'
import { decodeServerPush, type InvalidPushReason } from './push-protocol.ts'
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
  onInvalidPush(event: Parameters<typeof decodeServerPush>[0], reason: InvalidPushReason): void
  onDrawStrokeBatch(meta: DrawingIncrementMeta, stroke: Stroke): void
  onDrawFillCommit(meta: DrawingIncrementMeta, fill: FillCommand): void
}

function decodeData<E extends ServerPushEventName>(
  event: E,
  raw: unknown,
  handlers: SocketHandlers,
): ServerPushData<E> | undefined {
  const result = decodeServerPush(event, raw)
  if (!result.ok) {
    handlers.onInvalidPush(event, result.reason)
    return undefined
  }
  return result.data
}

const activeDetachers = new WeakMap<Socket, Set<() => void>>()

/**
 * 注册全部服务端推送事件监听（全局唯一的连接生命周期）。
 * 注意：绘图增量事件按回合 ID 与序号直接合并进本地历史，无需等待下一次快照。
 */
export function attachSocketListeners(handlers: SocketHandlers, targetSocket: Socket): () => void {
  const onConnect = () => handlers.onConnect()
  const onDisconnect = (reason: string) => handlers.onDisconnect(reason)
  const onReconnectAttempt = () => handlers.onReconnectAttempt()
  const onIoError = () => handlers.onIoError()
  const onPresence = (raw: unknown) => {
    const snapshot = decodeData(EVENTS.presenceSnapshot, raw, handlers)
    if (snapshot) handlers.onPresence(snapshot)
  }
  const onRooms = (raw: unknown) => {
    const rooms = decodeData(EVENTS.roomListChanged, raw, handlers)
    if (rooms) handlers.onRooms(rooms)
  }
  const onRoomSnapshot = (raw: unknown) => {
    const snapshot = decodeData(EVENTS.roomSnapshot, raw, handlers)
    if (snapshot) handlers.onRoomSnapshot(snapshot)
  }
  const onMemberConnectionChanged = (raw: unknown) => {
    const change = decodeData(EVENTS.roomMemberConnectionChanged, raw, handlers)
    if (change) handlers.onMemberConnectionChanged(change)
  }
  const onInviteReceived = (raw: unknown) => {
    const invite = decodeData(EVENTS.inviteReceived, raw, handlers)
    if (invite) handlers.onInviteReceived(invite)
  }
  const onInviteResolved = (raw: unknown) => {
    const payload = decodeData(EVENTS.inviteResolved, raw, handlers)
    if (payload) handlers.onInviteResolved(payload.id)
  }
  const onRoomClosed = (raw: unknown) => {
    const payload = decodeData(EVENTS.roomClosed, raw, handlers)
    if (payload) handlers.onRoomClosed(payload.reason)
  }
  const onSystemNotice = (raw: unknown) => {
    const payload = decodeData(EVENTS.systemNotice, raw, handlers)
    if (payload) handlers.onSystemNotice(payload.text)
  }
  const onSystemError = (raw: unknown) => {
    const payload = decodeData(EVENTS.systemError, raw, handlers)
    if (payload) handlers.onSystemError(payload.text)
  }
  const onDrawStrokeBatch = (raw: unknown) => {
    const payload = decodeData(EVENTS.drawStrokeBatch, raw, handlers)
    if (payload) handlers.onDrawStrokeBatch(payload, payload.stroke)
  }
  const onDrawFillCommit = (raw: unknown) => {
    const payload = decodeData(EVENTS.drawFillCommit, raw, handlers)
    if (payload) handlers.onDrawFillCommit(payload, payload.fill)
  }

  targetSocket.on('connect', onConnect)
  targetSocket.on('disconnect', onDisconnect)
  targetSocket.io.on('reconnect_attempt', onReconnectAttempt)
  targetSocket.io.on('error', onIoError)
  targetSocket.on(EVENTS.presenceSnapshot, onPresence)
  targetSocket.on(EVENTS.roomListChanged, onRooms)
  targetSocket.on(EVENTS.roomSnapshot, onRoomSnapshot)
  targetSocket.on(EVENTS.roomMemberConnectionChanged, onMemberConnectionChanged)
  targetSocket.on(EVENTS.inviteReceived, onInviteReceived)
  targetSocket.on(EVENTS.inviteResolved, onInviteResolved)
  targetSocket.on(EVENTS.roomClosed, onRoomClosed)
  targetSocket.on(EVENTS.systemNotice, onSystemNotice)
  targetSocket.on(EVENTS.systemError, onSystemError)
  targetSocket.on(EVENTS.drawStrokeBatch, onDrawStrokeBatch)
  targetSocket.on(EVENTS.drawFillCommit, onDrawFillCommit)

  /**
   * 返回解绑函数：开发态 HMR 或 store 销毁时调用，避免同一事件被重复注册
   * （否则会出现 invites 双推、drawRevision 双增、多个探测定时器）。
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
    targetSocket.off(EVENTS.presenceSnapshot, onPresence)
    targetSocket.off(EVENTS.roomListChanged, onRooms)
    targetSocket.off(EVENTS.roomSnapshot, onRoomSnapshot)
    targetSocket.off(EVENTS.roomMemberConnectionChanged, onMemberConnectionChanged)
    targetSocket.off(EVENTS.inviteReceived, onInviteReceived)
    targetSocket.off(EVENTS.inviteResolved, onInviteResolved)
    targetSocket.off(EVENTS.roomClosed, onRoomClosed)
    targetSocket.off(EVENTS.systemNotice, onSystemNotice)
    targetSocket.off(EVENTS.systemError, onSystemError)
    targetSocket.off(EVENTS.drawStrokeBatch, onDrawStrokeBatch)
    targetSocket.off(EVENTS.drawFillCommit, onDrawFillCommit)
    activeDetachers.get(targetSocket)?.delete(detach)
  }
  const detachers = activeDetachers.get(targetSocket) ?? new Set<() => void>()
  detachers.add(detach)
  activeDetachers.set(targetSocket, detachers)
  return detach
}

/** HMR 与应用销毁共用：精确移除本模块注册项，不触碰其它订阅者的同名事件。 */
export function disposeSocketLifecycle(targetSocket: Socket): void {
  for (const detach of [...(activeDetachers.get(targetSocket) ?? [])]) detach()
  activeDetachers.delete(targetSocket)
  targetSocket.disconnect()
}
