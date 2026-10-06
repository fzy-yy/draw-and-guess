/**
 * 接龙对局 WebSocket 网关。
 *
 * 遵循《后端架构规范》R4.6b：
 * 挂载接龙提交（作画、猜词）、投票与接龙独立聊天事件。
 * `chat:say` 是接龙房专属的社交频道（S79 / S85），与作答彻底分离，因此归接龙模块所有——
 * 它必须写入协议合法的消息（id 走注入的 RandomSource），重复实现在别处会让整份快照被客户端丢弃。
 */
import { EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../../protocol/binder.ts'
import type { AppSocket } from '../../socket-types.ts'
import type { RelayService } from './relay.service.ts'

export interface RelayGatewayDeps {
  relayService: RelayService
}

/**
 * 挂载接龙对局相关事件。
 */
export function registerRelayGateway(socket: AppSocket, deps: RelayGatewayDeps): void {
  const { relayService } = deps

  // 1. 提交本棒猜词
  bindRequest(socket, EVENTS.relaySubmitGuess, (input, playerId) =>
    relayService.submitGuess(playerId, input.stepId, input.text),
  )

  // 2. 提交本棒作画
  bindRequest(socket, EVENTS.relaySubmitDrawing, (input, playerId) =>
    relayService.submitDrawing(playerId, input.stepId),
  )

  // 3. 复盘投票
  bindRequest(socket, EVENTS.relayVote, (input, playerId) =>
    relayService.vote(playerId, input.choice),
  )

  // 4. 接龙独立聊天（S79）：自由社交频道，永不携带作答
  bindRequest(socket, EVENTS.chatSay, (input, playerId) => relayService.chat(playerId, input.text))
}
