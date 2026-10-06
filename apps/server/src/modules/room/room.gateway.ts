/**
 * 房间与邀请 WebSocket 网关。
 *
 * 遵循《后端架构规范》R4.6b 与 R4.6d：
 * 入口层只做事件监听接入与参数委派，调用对应的领域服务（RoomService、InviteService、RoomVocabularyService）。
 */
import { EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../../protocol/binder.ts'
import type { AppSocket } from '../../socket-types.ts'
import type { RoomService } from './room.service.ts'
import type { InviteService } from './invite.service.ts'
import type { RoomVocabularyService } from '../vocabulary/vocabulary.service.ts'

/**
 * 房间网关依赖集合。
 */
export interface RoomGatewayDeps {
  roomService: RoomService
  inviteService: InviteService
  vocabularyService: RoomVocabularyService
}

/**
 * 为指定 Socket 连接挂载房间与邀请相关协议事件。
 */
export function registerRoomGateway(socket: AppSocket, deps: RoomGatewayDeps): void {
  const { roomService, inviteService, vocabularyService } = deps

  // 1. 房间生命周期：创建、加入公开、加入私密、离开
  bindRequest(socket, EVENTS.roomCreate, (input, playerId) =>
    roomService.createRoom(playerId, input),
  )
  bindRequest(socket, EVENTS.roomJoin, (input, playerId) =>
    roomService.joinRoom(playerId, input.roomId),
  )
  bindRequest(socket, EVENTS.roomJoinPrivate, (input, playerId) =>
    roomService.joinPrivateRoom(playerId, input.code),
  )
  bindRequest(socket, EVENTS.roomLeave, (_input, playerId) => roomService.leaveRoom(playerId))

  // 2. 房间规则与状态：准备、改规则
  bindRequest(socket, EVENTS.roomSetReady, (input, playerId) =>
    roomService.setReady(playerId, input.ready),
  )
  bindRequest(socket, EVENTS.roomUpdateSettings, (input, playerId) =>
    roomService.updateSettings(playerId, input.patch, input.expectedVersion),
  )

  // 3. 房间词库管理：读取快照、勾选词条、切换词库包
  bindRequest(socket, EVENTS.roomGetVocabulary, (_input, playerId) =>
    vocabularyService.get(playerId),
  )
  bindRequest(socket, EVENTS.roomUpdateVocabulary, (input, playerId) =>
    vocabularyService.update(playerId, input.ids, input.expectedVersion),
  )
  bindRequest(socket, EVENTS.roomSelectVocabularyPackage, (input, playerId) =>
    vocabularyService.selectPackages(playerId, input.packageIds, input.expectedVersion),
  )

  // 4. 房主管理：踢人、移交房主
  bindRequest(socket, EVENTS.roomKick, (input, playerId) =>
    roomService.kick(playerId, input.targetId),
  )
  bindRequest(socket, EVENTS.roomTransferHost, (input, playerId) =>
    roomService.transferHost(playerId, input.targetId),
  )

  // 5. 定向邀请：发送邀请、应答邀请
  bindRequest(socket, EVENTS.inviteSend, (input, playerId) =>
    inviteService.send(playerId, input.targetId),
  )
  bindRequest(socket, EVENTS.inviteRespond, (input, playerId) =>
    inviteService.respond(playerId, input.inviteId, input.accept),
  )
}
