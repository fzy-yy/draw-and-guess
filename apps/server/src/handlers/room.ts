/**
 * 房间生命周期与成员管理事件处理器：创建/加入/离开、准备、规则、词库、房主管理、邀请。
 */
import { EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../protocol/binder.ts'
import type { GameService } from '../game-service.ts'
import type { AppSocket } from '../socket-types.ts'

/** 注册房间相关的全部请求事件。 */
export function registerRoomHandlers(socket: AppSocket, service: GameService): void {
  // 房间生命周期：创建 / 加入 / 离开
  bindRequest(socket, EVENTS.roomCreate, (input, playerId) => service.createRoom(playerId, input))
  bindRequest(socket, EVENTS.roomJoin, (input, playerId) =>
    service.joinRoom(playerId, input.roomId),
  )
  bindRequest(socket, EVENTS.roomJoinPrivate, (input, playerId) =>
    service.joinPrivateRoom(playerId, input.code),
  )
  bindRequest(socket, EVENTS.roomLeave, (_input, playerId) => service.leaveRoom(playerId))
  // 房间规则：准备、改规则（含差一字提示与画布微表情开关）、词库管理
  bindRequest(socket, EVENTS.roomSetReady, (input, playerId) =>
    service.setReady(playerId, input.ready),
  )
  bindRequest(socket, EVENTS.roomUpdateSettings, (input, playerId) =>
    service.updateSettings(playerId, input.patch, input.expectedVersion),
  )
  bindRequest(socket, EVENTS.roomGetVocabulary, (_input, playerId) =>
    service.getVocabulary(playerId),
  )
  bindRequest(socket, EVENTS.roomUpdateVocabulary, (input, playerId) =>
    service.updateVocabulary(playerId, input.ids, input.expectedVersion),
  )
  bindRequest(socket, EVENTS.roomSelectVocabularyPackage, (input, playerId) =>
    service.selectVocabularyPackages(playerId, input.packageIds, input.expectedVersion),
  )
  // 房主管理：踢人 / 移交房主
  bindRequest(socket, EVENTS.roomKick, (input, playerId) => service.kick(playerId, input.targetId))
  bindRequest(socket, EVENTS.roomTransferHost, (input, playerId) =>
    service.transferHost(playerId, input.targetId),
  )
  // 定向邀请：发送 / 应答
  bindRequest(socket, EVENTS.inviteSend, (input, playerId) =>
    service.sendInvite(playerId, input.targetId),
  )
  bindRequest(socket, EVENTS.inviteRespond, (input, playerId) =>
    service.respondInvite(playerId, input.inviteId, input.accept),
  )
}
