/**
 * 对局控制事件处理器：开始、选词、提前结束、返回房间。
 */
import { EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../protocol/binder.ts'
import type { GameService } from '../game-service.ts'
import type { AppSocket } from '../socket-types.ts'

/** 注册对局控制相关请求事件（guess/chat/draw 不在此文件）。 */
export function registerGameHandlers(socket: AppSocket, service: GameService): void {
  bindRequest(socket, EVENTS.gameStart, (input, playerId) =>
    service.startGame(playerId, input.expectedVersion),
  )
  bindRequest(socket, EVENTS.gameChooseWord, (input, playerId) =>
    service.chooseWord(playerId, input.roundId, input.wordId),
  )
  bindRequest(socket, EVENTS.gameRerollWords, (input, playerId) =>
    service.rerollWordOptions(playerId, input.roundId),
  )
  bindRequest(socket, EVENTS.gameCustomWord, (input, playerId) =>
    service.chooseCustomWord(playerId, input.roundId, input.text),
  )
  bindRequest(socket, EVENTS.gameEndEarly, (_input, playerId) => service.endEarly(playerId))
  // 接龙提交事件（S30）：猜词带文本（S15 禁空提交、提交即锁定、不进聊天流）、作画只标记完成。
  bindRequest(socket, EVENTS.relaySubmitGuess, (input, playerId) =>
    service.submitRelayGuess(playerId, input.stepId, input.text),
  )
  bindRequest(socket, EVENTS.relaySubmitDrawing, (input, playerId) =>
    service.submitRelayDrawing(playerId, input.stepId),
  )
  // 接龙投票（S13 / S14）：只有赞同 / 不赞同（schema 在协议层 strict 拒绝其它值）；
  // 目标是服务端权威游标指向的那条链，请求里不带链信息，点下即锁定。
  bindRequest(socket, EVENTS.relayVote, (input, playerId) =>
    service.voteRelay(playerId, input.choice),
  )
  bindRequest(socket, EVENTS.gameLeave, (_input, playerId) => service.leaveGame(playerId))
  bindRequest(socket, EVENTS.gameReturnWaiting, (_input, playerId) =>
    service.returnWaiting(playerId),
  )
  bindRequest(
    socket,
    EVENTS.gameCanvasPing,
    (input, playerId) => service.sendCanvasPing(playerId, input.x, input.y, input.type),
    { rateLimit: false },
  )
}
