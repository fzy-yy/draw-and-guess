/**
 * 猜词与互动短语事件处理器。
 */
import { CLIENT_REQUEST_SCHEMAS, EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../protocol/binder.ts'
import type { GameService } from '../game-service.ts'

/** 注册猜词与预设短语相关请求事件。 */
export function registerChatHandlers(
  socket: import('socket.io').Socket,
  service: GameService,
): void {
  bindRequest(
    socket,
    EVENTS.guessSubmit,
    CLIENT_REQUEST_SCHEMAS[EVENTS.guessSubmit],
    (input, playerId) => service.submitGuess(playerId, input.roundId, input.text),
  )
  bindRequest(
    socket,
    EVENTS.chatPreset,
    CLIENT_REQUEST_SCHEMAS[EVENTS.chatPreset],
    (input, playerId) => service.sendPreset(playerId, input.roundId, input.preset),
  )
}
