/**
 * 会话与通用事件处理器：注册、资料、偏好、大厅查询、延迟检测与断线。
 */
import { z } from 'zod'
import {
  EVENTS,
  ProfileSchema,
  RegisterSchema,
  RequestSchema,
  type RoomSnapshot,
  type SessionRegistration,
} from '@draw-guess/shared'
import { bindRequest } from '../protocol/binder.ts'
import type { GameService } from '../game-service.ts'

/** 注册会话、修改资料/偏好、读取大厅、ping 与断线兜底。 */
export function registerSessionHandlers(
  socket: import('socket.io').Socket,
  service: GameService,
): void {
  bindRequest(
    socket,
    EVENTS.sessionRegister,
    RegisterSchema,
    (input) => {
      const identity = service.register(socket, input)
      // 把该玩家的幂等缓存挂到 socket 上，供后续请求复用。
      socket.data.requestCache = service.players.get(identity.player.id)?.requestCache
      // 注册 ack 必须显式携带 room|null，客户端才能原子清除旧房间；恢复对局时强制返回全量画布，
      // 避免页面刷新后的空本地历史收到 strokesOmitted 快照而显示空画布。
      const room = service.snapshotForPlayer(identity.player.id, true) ?? null
      const result: SessionRegistration = { ...identity, room }
      socket.emit(EVENTS.sessionReady, result)
      socket.emit(EVENTS.presenceSnapshot, service.presenceSnapshot())
      if (room) socket.emit(EVENTS.roomSnapshot, room)
      return result
    },
    { registration: true },
  )

  bindRequest(
    socket,
    EVENTS.sessionUpdateProfile,
    RequestSchema.extend({ profile: ProfileSchema }),
    (input, playerId) => service.updateProfile(playerId, input.profile),
  )
  bindRequest(
    socket,
    EVENTS.presenceUpdatePreferences,
    RequestSchema.extend({ discoverable: z.boolean(), acceptsInvites: z.boolean() }),
    (input, playerId) => service.updatePreferences(playerId, input),
  )
  bindRequest(
    socket,
    EVENTS.roomList,
    RequestSchema,
    (_input, _playerId) => service.presenceSnapshot().rooms,
  )
  // 状态重同步：断线恢复/大厅刷新时拉取权威房间快照（可能为 undefined，表示不在房间）
  // forceFull=true：仅作为客户端“本地落后于权威 lastSequence”时的自检修复通道，拉取完整画布历史
  bindRequest(socket, EVENTS.stateResync, RequestSchema, (_input, playerId) =>
    service.snapshotForPlayer(playerId, true),
  )
  // 网络检测：往返延迟估算（低频，无需限频）
  bindRequest(
    socket,
    EVENTS.networkPing,
    RequestSchema.extend({ clientTime: z.number() }),
    (input) => ({ clientTime: input.clientTime, serverTime: Date.now() }),
    { rateLimit: false },
  )

  socket.on('disconnect', () => service.handleDisconnect(socket))
}

export type { RoomSnapshot }
