/**
 * Socket 连接单例与其推送事件绑定。
 * 与 store 解耦：监听器通过回调接口桥接回 store 状态，便于独立测试与复用。
 */
import { io, type Socket } from 'socket.io-client'
import {
  EVENTS,
  type FillCommand,
  type Invite,
  type PresenceSnapshot,
  type PublicRoom,
  type RoomSnapshot,
  type Stroke,
} from '@draw-guess/shared'

/** 服务端推送事件到 store 的回调集合。 */
export interface SocketHandlers {
  onConnect(): void
  onDisconnect(reason: string): void
  onReconnectAttempt(): void
  onIoError(): void
  onPresence(snapshot: PresenceSnapshot): void
  onRooms(rooms: PublicRoom[]): void
  onRoomSnapshot(snapshot: RoomSnapshot): void
  onInviteReceived(invite: Invite): void
  onInviteResolved(id: string): void
  onRoomClosed(reason: string): void
  onSystemNotice(text: string): void
  onSystemError(message: string): void
  /** 服务端定向推送给猜词者的“很接近”提示（不进入聊天流，避免刷屏与泄露答案）。 */
  onGuessClose(text: string): void
  onDrawStrokeBatch(roundId: string, stroke: Stroke): void
  onDrawFillCommit(roundId: string, fill: FillCommand): void
}

/** Socket 实例放在模块级，避免 Pinia devtools 序列化传输对象和监听器。 */
export const socket: Socket = io({
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
})

// F3：开发模式 HMR 热替换时关闭旧 socket，避免残留连接叠加（生产构建无影响）
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
  socket.on(EVENTS.presenceSnapshot, (snapshot: PresenceSnapshot) => handlers.onPresence(snapshot))
  socket.on(EVENTS.roomListChanged, (rooms: PublicRoom[]) => handlers.onRooms(rooms))
  socket.on(EVENTS.roomSnapshot, (snapshot: RoomSnapshot) => handlers.onRoomSnapshot(snapshot))
  socket.on(EVENTS.inviteReceived, (invite: Invite) => handlers.onInviteReceived(invite))
  socket.on(EVENTS.inviteResolved, ({ id }: { id: string }) => handlers.onInviteResolved(id))
  socket.on(EVENTS.roomClosed, ({ reason }: { reason: string }) => handlers.onRoomClosed(reason))
  socket.on(EVENTS.systemNotice, ({ text }: { text: string }) => handlers.onSystemNotice(text))
  socket.on(EVENTS.systemError, ({ message }: { message: string }) =>
    handlers.onSystemError(message),
  )
  socket.on(EVENTS.guessClose, ({ text }: { text: string }) => handlers.onGuessClose(text))
  socket.on(EVENTS.drawStrokeBatch, ({ roundId, stroke }: { roundId: string; stroke: Stroke }) =>
    handlers.onDrawStrokeBatch(roundId, stroke),
  )
  socket.on(EVENTS.drawFillCommit, ({ roundId, fill }: { roundId: string; fill: FillCommand }) =>
    handlers.onDrawFillCommit(roundId, fill),
  )

  /**
   * 返回解绑函数：开发态 HMR 或 store 销毁时调用，避免同一事件被重复注册
   * （否则会出现 invites 双推、drawRevision 双增、多个探测定时器）。
   * 只解绑应用层事件与连接事件，不动 socket.io 内部机制（重连、心跳）。
   */
  return () => {
    for (const event of [
      'connect',
      'disconnect',
      EVENTS.presenceSnapshot,
      EVENTS.roomListChanged,
      EVENTS.roomSnapshot,
      EVENTS.inviteReceived,
      EVENTS.inviteResolved,
      EVENTS.roomClosed,
      EVENTS.systemNotice,
      EVENTS.systemError,
      EVENTS.guessClose,
      EVENTS.drawStrokeBatch,
      EVENTS.drawFillCommit,
    ])
      socket.off(event)
  }
}
