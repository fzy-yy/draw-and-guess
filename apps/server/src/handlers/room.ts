/**
 * 房间生命周期与成员管理事件处理器：创建/加入/离开、准备、规则、词库、房主管理、邀请。
 */
import { z } from 'zod'
import {
  CreateRoomSchema,
  EVENTS,
  JoinPrivateRoomSchema,
  JoinRoomSchema,
  RequestSchema,
  RoomSettingsSchema,
  WordIdSchema,
} from '@draw-guess/shared'
import { bindRequest } from '../protocol/binder.ts'
import type { GameService } from '../game-service.ts'

/** 注册房间相关的全部请求事件。 */
export function registerRoomHandlers(
  socket: import('socket.io').Socket,
  service: GameService,
): void {
  // 房间生命周期：创建 / 加入 / 离开
  bindRequest(socket, EVENTS.roomCreate, CreateRoomSchema, (input, playerId) =>
    service.createRoom(playerId, input),
  )
  bindRequest(socket, EVENTS.roomJoin, JoinRoomSchema, (input, playerId) =>
    service.joinRoom(playerId, input.roomId),
  )
  bindRequest(socket, EVENTS.roomJoinPrivate, JoinPrivateRoomSchema, (input, playerId) =>
    service.joinPrivateRoom(playerId, input.code),
  )
  bindRequest(socket, EVENTS.roomLeave, RequestSchema, (_input, playerId) =>
    service.leaveRoom(playerId),
  )
  // 房间规则：准备、改规则、词库管理
  bindRequest(
    socket,
    EVENTS.roomSetReady,
    RequestSchema.extend({ ready: z.boolean() }),
    (input, playerId) => service.setReady(playerId, input.ready),
  )
  bindRequest(
    socket,
    EVENTS.roomUpdateSettings,
    RequestSchema.extend({
      patch: RoomSettingsSchema.partial(),
      expectedVersion: z.number().int().nonnegative(),
    }),
    (input, playerId) => service.updateSettings(playerId, input.patch, input.expectedVersion),
  )
  bindRequest(socket, EVENTS.roomGetVocabulary, RequestSchema, (_input, playerId) =>
    service.getVocabulary(playerId),
  )
  bindRequest(
    socket,
    EVENTS.roomUpdateVocabulary,
    RequestSchema.extend({
      // 词库词条 ID：格式与来源解耦（见 shared WordIdSchema），数量上限为权威词库规模
      ids: z.array(WordIdSchema).max(service.vocabulary.items.length),
      expectedVersion: z.number().int().nonnegative(),
    }),
    (input, playerId) => service.updateVocabulary(playerId, input.ids, input.expectedVersion),
  )
  // 房主管理：踢人 / 移交房主
  bindRequest(
    socket,
    EVENTS.roomKick,
    RequestSchema.extend({ targetId: z.string().uuid() }),
    (input, playerId) => service.kick(playerId, input.targetId),
  )
  bindRequest(
    socket,
    EVENTS.roomTransferHost,
    RequestSchema.extend({ targetId: z.string().uuid() }),
    (input, playerId) => service.transferHost(playerId, input.targetId),
  )
  // 定向邀请：发送 / 应答
  bindRequest(
    socket,
    EVENTS.inviteSend,
    RequestSchema.extend({ targetId: z.string().uuid() }),
    (input, playerId) => service.sendInvite(playerId, input.targetId),
  )
  bindRequest(
    socket,
    EVENTS.inviteRespond,
    RequestSchema.extend({ inviteId: z.string().uuid(), accept: z.boolean() }),
    (input, playerId) => service.respondInvite(playerId, input.inviteId, input.accept),
  )
}
