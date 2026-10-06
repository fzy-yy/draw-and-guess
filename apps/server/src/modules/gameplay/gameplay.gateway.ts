/**
 * 对局控制 WebSocket 网关。
 *
 * 遵循《后端架构规范》R4.6b：
 * 挂载经典对局生命周期控制事件（开始、选词、换一组、自定义词、提前结束、退局、再来一局）。
 */
import { EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../../protocol/binder.ts'
import type { AppSocket } from '../../socket-types.ts'
import type { GameplayService } from './gameplay.service.ts'
import type { RoomService } from '../room/room.service.ts'

export interface GameplayGatewayDeps {
  gameplayService: GameplayService
  roomService: RoomService
}

/**
 * 挂载对局生命周期控制事件。
 */
export function registerGameplayGateway(socket: AppSocket, deps: GameplayGatewayDeps): void {
  const { gameplayService, roomService } = deps

  // 1. 开始对局
  bindRequest(socket, EVENTS.gameStart, (input, playerId) =>
    gameplayService.startGame(playerId, input.expectedVersion),
  )

  // 2. 选词
  bindRequest(socket, EVENTS.gameChooseWord, (input, playerId) =>
    gameplayService.chooseWord(playerId, input.roundId, input.wordId),
  )

  // 3. 换一组候选词
  bindRequest(socket, EVENTS.gameRerollWords, (input, playerId) =>
    gameplayService.rerollWordOptions(playerId, input.roundId),
  )

  // 4. 自定义词开画
  bindRequest(socket, EVENTS.gameCustomWord, (input, playerId) =>
    gameplayService.chooseCustomWord(playerId, input.roundId, input.text),
  )

  // 5. 房主提前结束
  bindRequest(socket, EVENTS.gameEndEarly, (_input, playerId) => gameplayService.endEarly(playerId))

  // 6. 主动退局
  bindRequest(socket, EVENTS.gameLeave, (_input, playerId) => roomService.leaveGame(playerId))

  // 7. 结算后返回等待房间
  bindRequest(socket, EVENTS.gameReturnWaiting, (_input, playerId) =>
    gameplayService.returnWaiting(playerId),
  )
}
