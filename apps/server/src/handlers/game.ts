/**
 * 对局控制事件处理器：开始、选词、暂停/恢复、提前结束、返回房间。
 */
import { z } from 'zod'
import { EVENTS, RequestSchema } from '@draw-guess/shared'
import { bindRequest } from '../protocol/binder.ts'
import type { GameService } from '../game-service.ts'

/** 注册对局控制相关请求事件（guess/chat/draw 不在此文件）。 */
export function registerGameHandlers(
  socket: import('socket.io').Socket,
  service: GameService,
): void {
  bindRequest(
    socket,
    EVENTS.gameStart,
    RequestSchema.extend({ expectedVersion: z.number().int().nonnegative() }),
    (input, playerId) => service.startGame(playerId, input.expectedVersion),
  )
  bindRequest(
    socket,
    EVENTS.gameChooseWord,
    RequestSchema.extend({ roundId: z.string().uuid(), wordId: z.string() }),
    (input, playerId) => service.chooseWord(playerId, input.roundId, input.wordId),
  )
  bindRequest(
    socket,
    EVENTS.gamePauseRequest,
    RequestSchema.extend({ reason: z.string().max(40) }),
    (input, playerId) => service.pause(playerId, input.reason),
  )
  bindRequest(socket, EVENTS.gameResume, RequestSchema, (_input, playerId) =>
    service.resume(playerId),
  )
  bindRequest(socket, EVENTS.gameEndEarly, RequestSchema, (_input, playerId) =>
    service.endEarly(playerId),
  )
  bindRequest(socket, EVENTS.gameReturnWaiting, RequestSchema, (_input, playerId) =>
    service.returnWaiting(playerId),
  )
}
