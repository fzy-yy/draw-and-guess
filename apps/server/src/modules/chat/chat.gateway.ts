/**
 * 猜词与聊天 WebSocket 网关。
 *
 * 遵循《后端架构规范》R4.6b：
 * 挂载猜词、预设互动短语、画板微表情与接龙聊天事件。
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

  // 4. 接龙独立聊天
  bindRequest(socket, EVENTS.chatSay, (input, playerId) => {
    chatService.sendRelayChat(playerId, input.text)
  })
}
