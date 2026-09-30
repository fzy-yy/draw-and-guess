/**
 * 猜词与互动短语事件处理器。
 */
import { EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../protocol/binder.ts'
import type { GameService } from '../game-service.ts'
import type { AppSocket } from '../socket-types.ts'

/** 注册猜词与预设短语相关请求事件。 */
export function registerChatHandlers(socket: AppSocket, service: GameService): void {
  bindRequest(socket, EVENTS.guessSubmit, (input, playerId) =>
    service.submitGuess(playerId, input.roundId, input.text),
  )
  bindRequest(socket, EVENTS.chatPreset, (input, playerId) =>
    service.sendPreset(playerId, input.roundId, input.preset),
  )
}
