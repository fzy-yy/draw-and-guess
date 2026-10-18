/**
 * WebSocket 跨模块网关聚合装配层。
 *
 * 遵循《后端架构规范》R4.6b：
 * 连接回调只做装配，不承载业务；
 * 集中挂载各业务模块的 Gateway（Session、Room、Drawing、Chat、Gameplay、Relay）。
 */
import type { AppSocket } from '../socket-types.ts'
import {
  registerSessionGateway,
  type SessionGatewayDeps,
} from '../modules/session/session.gateway.ts'
import { registerRoomGateway, type RoomGatewayDeps } from '../modules/room/room.gateway.ts'
import {
  registerDrawingGateway,
  type DrawingGatewayDeps,
} from '../modules/drawing/drawing.gateway.ts'
import { registerChatGateway, type ChatGatewayDeps } from '../modules/chat/chat.gateway.ts'
import {
  registerGameplayGateway,
  type GameplayGatewayDeps,
} from '../modules/gameplay/gameplay.gateway.ts'
import { registerRelayGateway, type RelayGatewayDeps } from '../modules/relay/relay.gateway.ts'

export interface WsGatewayDependencies {
  session: SessionGatewayDeps
  room: RoomGatewayDeps
  drawing: DrawingGatewayDeps
  chat: ChatGatewayDeps
  gameplay: GameplayGatewayDeps
  relay: RelayGatewayDeps
}

/**
 * 为新建立的 Socket 连接挂载全部模块网关。
 */
export function registerAllGateways(socket: AppSocket, deps: WsGatewayDependencies): void {
  registerSessionGateway(socket, deps.session)
  registerRoomGateway(socket, deps.room)
  registerDrawingGateway(socket, deps.drawing)
  registerChatGateway(socket, deps.chat)
  registerGameplayGateway(socket, deps.gameplay)
  registerRelayGateway(socket, deps.relay)
}
