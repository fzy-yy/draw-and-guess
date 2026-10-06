/**
 * 经典猜词与互动 WebSocket 网关。
 *
 * 遵循《后端架构规范》R4.6b：
 * 挂载猜词、预设互动短语与画板微表情事件。
 * 接龙房专属的自由聊天（`chat:say`）不在这里——它归接龙模块（`relay.gateway.ts`），
 * 同一条事件只能有一个登记处（重复登记会让两份实现各自演化）。
 */
import { EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../../protocol/binder.ts'
import type { AppSocket } from '../../socket-types.ts'
import type { ChatService } from './chat.service.ts'

export interface ChatGatewayDeps {
  chatService: ChatService
}

/**
 * 挂载猜词与聊天相关事件。
 */
export function registerChatGateway(socket: AppSocket, deps: ChatGatewayDeps): void {
  const { chatService } = deps

  // 1. 提交猜词
  bindRequest(socket, EVENTS.guessSubmit, (input, playerId) =>
    chatService.submitGuess(playerId, input.roundId, input.text),
  )

  // 2. 发送快捷预设短语
  bindRequest(socket, EVENTS.chatPreset, (input, playerId) =>
    chatService.sendPreset(playerId, input.roundId, input.preset),
  )

  // 3. 发送画板微表情（👍 / ❓ / 🔥）
  bindRequest(socket, EVENTS.gameCanvasPing, (input, playerId) => {
    chatService.sendCanvasPing(playerId, input.x, input.y, input.type)
  })
}
