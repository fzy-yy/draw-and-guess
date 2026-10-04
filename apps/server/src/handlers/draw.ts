/**
 * 绘图事件处理器：经典与接龙的绘图事件族（笔画批次、区域填充、撤销 / 重做 / 清空）。
 * 全部跳过通用限频（bindRequest rateLimit: false），绘图有服务端专用的 45/s 滑动窗口限频；
 * 接龙事件只传步骤 id，目标画布由服务端解析（S51 / S53）。
 */
import { EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../protocol/binder.ts'
import type { GameService } from '../game-service.ts'
import type { AppSocket } from '../socket-types.ts'

/** 注册绘图相关请求事件。 */
export function registerDrawHandlers(socket: AppSocket, service: GameService): void {
  bindRequest(
    socket,
    EVENTS.drawStrokeBatch,
    (input, playerId) => service.addStroke(playerId, input.roundId, input.stroke),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawFillCommit,
    (input, playerId) => service.addFill(playerId, input.roundId, input.fill),
    { rateLimit: false },
  )
  bindRequest(socket, EVENTS.drawUndo, (input, playerId) => service.undo(playerId, input.roundId), {
    rateLimit: false,
  })
  bindRequest(socket, EVENTS.drawRedo, (input, playerId) => service.redo(playerId, input.roundId), {
    rateLimit: false,
  })
  bindRequest(
    socket,
    EVENTS.drawClear,
    (input, playerId) => service.clearDrawing(playerId, input.roundId),
    { rateLimit: false },
  )
  // 接龙绘图事件族（S51 / S48）：同样跳过通用限频，只走绘图专用 45/s 限频。
  // 目标画布不由客户端指定——服务端按 (观看者, stepId) 解析本棒链画布，越权 / 过期一律拒绝。
  bindRequest(
    socket,
    EVENTS.relayDrawStrokeBatch,
    (input, playerId) => service.addRelayStroke(playerId, input.stepId, input.stroke),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.relayDrawFillCommit,
    (input, playerId) => service.addRelayFill(playerId, input.stepId, input.fill),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.relayDrawUndo,
    (input, playerId) => service.relayUndo(playerId, input.stepId),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.relayDrawRedo,
    (input, playerId) => service.relayRedo(playerId, input.stepId),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.relayDrawClear,
    (input, playerId) => service.relayClear(playerId, input.stepId),
    { rateLimit: false },
  )
}
