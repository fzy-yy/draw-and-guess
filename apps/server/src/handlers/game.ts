/**
 * 对局控制事件处理器：开始、选词、暂停/恢复、提前结束、返回房间。
 */
import { CLIENT_REQUEST_SCHEMAS, EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../protocol/binder.ts'
import type { GameService } from '../game-service.ts'
import type { AppSocket } from '../socket-types.ts'

/** 注册对局控制相关请求事件（guess/chat/draw 不在此文件）。 */
export function registerGameHandlers(socket: AppSocket, service: GameService): void {
  bindRequest(
    socket,
    EVENTS.gameStart,
    CLIENT_REQUEST_SCHEMAS[EVENTS.gameStart],
    (input, playerId) => service.startGame(playerId, input.expectedVersion),
  )
  bindRequest(
    socket,
    EVENTS.gameChooseWord,
    CLIENT_REQUEST_SCHEMAS[EVENTS.gameChooseWord],
    (input, playerId) => service.chooseWord(playerId, input.roundId, input.wordId),
  )
  bindRequest(
    socket,
    EVENTS.gameRerollWords,
    CLIENT_REQUEST_SCHEMAS[EVENTS.gameRerollWords],
    (input, playerId) => service.rerollWordOptions(playerId, input.roundId),
  )
  bindRequest(
    socket,
    EVENTS.gamePauseRequest,
    CLIENT_REQUEST_SCHEMAS[EVENTS.gamePauseRequest],
    (input, playerId) => service.pause(playerId, input.reason),
  )
  bindRequest(
    socket,
    EVENTS.gameResume,
    CLIENT_REQUEST_SCHEMAS[EVENTS.gameResume],
    (_input, playerId) => service.resume(playerId),
  )
  bindRequest(
    socket,
    EVENTS.gameEndEarly,
    CLIENT_REQUEST_SCHEMAS[EVENTS.gameEndEarly],
    (_input, playerId) => service.endEarly(playerId),
  )
  bindRequest(
    socket,
    EVENTS.gameLeave,
    CLIENT_REQUEST_SCHEMAS[EVENTS.gameLeave],
    (_input, playerId) => service.leaveGame(playerId),
  )
  bindRequest(
    socket,
    EVENTS.gameReturnWaiting,
    CLIENT_REQUEST_SCHEMAS[EVENTS.gameReturnWaiting],
    (_input, playerId) => service.returnWaiting(playerId),
  )
}
