/**
 * 玩家会话与全局网络状态 WebSocket 网关。
 *
 * 遵循《后端架构规范》R4.6b 与 R4.6d：
 * 1. 作为入口层适配器，只做协议接入与调用委派（每函数 3~8 行）；
 * 2. 结合统一包装器完成 schema 校验与错误收口；
 * 3. 负责连接断开生命周期监听。
 */
import { EVENTS, createServerPush, type SessionRegistration } from '@draw-guess/shared'
import { bindRequest } from '../../protocol/binder.ts'
import type { AppSocket } from '../../socket-types.ts'
import type { Clock } from '../../core/runtime.ts'
import type { SessionService } from './session.service.ts'
import type { RoomPublisher } from '../../application/room-publisher.ts'

/**
 * 会话网关依赖契约。
 */
export interface SessionGatewayDeps {
  service: SessionService
  publisher: RoomPublisher
  clock: Clock
}

/**
 * 为单个 Socket 连接注册会话相关协议事件。
 */
export function registerSessionGateway(socket: AppSocket, deps: SessionGatewayDeps): void {
  const { service, publisher, clock } = deps

  // 1. 玩家注册 / 恢复会话
  bindRequest(
    socket,
    EVENTS.sessionRegister,
    (input) => {
      const identity = service.register(socket, input)
      const room = publisher.snapshotForPlayer(identity.player.id, true) ?? null
      const result: SessionRegistration = { ...identity, room }

      socket.emit(
        EVENTS.presenceSnapshot,
        createServerPush(EVENTS.presenceSnapshot, publisher.presenceSnapshot()),
      )
      if (room) {
        socket.emit(EVENTS.roomSnapshot, createServerPush(EVENTS.roomSnapshot, room))
      }
      return result
    },
    { registration: true },
  )

  // 2. 玩家主动注销身份
  bindRequest(
    socket,
    EVENTS.sessionLogout,
    () => {
      service.logout(socket)
      return { success: true }
    },
    { registration: true },
  )

  // 3. 更新玩家资料（昵称、头像）
  bindRequest(socket, EVENTS.sessionUpdateProfile, (input, playerId) =>
    service.updateProfile(playerId, input.profile),
  )

  // 4. 获取在线玩家与大厅列表
  bindRequest(socket, EVENTS.presenceGet, () => publisher.presenceSnapshot())

  // 5. 更新大厅发现与邀请偏好
  bindRequest(socket, EVENTS.presenceUpdatePreferences, (input, playerId) =>
    service.updatePreferences(playerId, input),
  )

  // 6. 获取公开房间列表
  bindRequest(socket, EVENTS.roomList, () => publisher.publicRooms())

  // 7. 客户端状态强制重同步
  bindRequest(socket, EVENTS.stateResync, (_input, playerId) =>
    publisher.snapshotForPlayer(playerId, true),
  )

  // 8. 网络测速 Ping
  bindRequest(
    socket,
    EVENTS.networkPing,
    (input) => ({ clientTime: input.clientTime, serverTime: clock.now() }),
    { rateLimit: false },
  )

  // 9. 连接物理断开兜底
  socket.on('disconnect', () => service.handleDisconnect(socket))
}
