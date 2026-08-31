/**
 * 猜词与互动短语事件处理器。
 */
import { z } from 'zod'
import { APP_CONFIG } from '../../../../config.ts'
import { EVENTS, RequestSchema } from '@draw-guess/shared'
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
    RequestSchema.extend({
      roundId: z.string().uuid(),
      text: z.string().min(1).max(APP_CONFIG.player.chatMaxLength),
    }),
    (input, playerId) => service.submitGuess(playerId, input.roundId, input.text),
  )
  bindRequest(
    socket,
    EVENTS.chatPreset,
    RequestSchema.extend({ roundId: z.string().uuid(), preset: z.string() }),
    (input, playerId) => service.sendPreset(playerId, input.roundId, input.preset),
  )
}
