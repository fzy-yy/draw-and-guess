/**
 * 猜词、互动短语与接龙自由聊天的事件处理器。
 */
import { EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../protocol/binder.ts'
import type { GameService } from '../game-service.ts'
import type { AppSocket } from '../socket-types.ts'

/** 注册猜词、预设短语与接龙聊天相关请求事件。 */
export function registerChatHandlers(socket: AppSocket, service: GameService): void {
  bindRequest(socket, EVENTS.guessSubmit, (input, playerId) =>
    service.submitGuess(playerId, input.roundId, input.text),
  )
  bindRequest(socket, EVENTS.chatPreset, (input, playerId) =>
    service.sendPreset(playerId, input.roundId, input.preset),
  )
  // 接龙独立聊天（S79）：只服务接龙房间（经典保持「猜词未命中即聊天」的现状，S85），
  // 经典房间与无对局房间由服务端的 requireRelay 以 NO_GAME 拒绝。
  bindRequest(socket, EVENTS.chatSay, (input, playerId) =>
    service.sendRelayChat(playerId, input.text),
  )
}
