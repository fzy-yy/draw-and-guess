/**
 * 画板绘图 WebSocket 网关。
 *
 * 遵循《后端架构规范》R4.6b：
 * 挂载经典与接龙的绘图事件族（笔画批次、区域填充、撤销 / 重做 / 清空）。
 * 全部跳过通用限频（rateLimit: false），由服务层执行专用的 45 次/秒绘图滑动窗口限频。
 */
import { EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../../protocol/binder.ts'
import type { AppSocket } from '../../socket-types.ts'
import type { DrawingService } from './drawing.service.ts'

export interface DrawingGatewayDeps {
  drawingService: DrawingService
  relayDrawingService?: DrawingService
}

/**
 * 挂载画板绘图相关事件。
 */
export function registerDrawingGateway(socket: AppSocket, deps: DrawingGatewayDeps): void {
  const { drawingService, relayDrawingService } = deps

  // 1. 经典模式绘图
  bindRequest(
    socket,
    EVENTS.drawStrokeBatch,
    (input, playerId) => drawingService.addStroke(playerId, input.roundId, input.stroke),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawFillCommit,
    (input, playerId) => drawingService.addFill(playerId, input.roundId, input.fill),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawUndo,
    (input, playerId) => drawingService.undo(playerId, input.roundId),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawRedo,
    (input, playerId) => drawingService.redo(playerId, input.roundId),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawClear,
    (input, playerId) => drawingService.clear(playerId, input.roundId),
    { rateLimit: false },
  )

  // 2. 接龙模式绘图
  if (relayDrawingService) {
    bindRequest(
      socket,
      EVENTS.relayDrawStrokeBatch,
      (input, playerId) => relayDrawingService.addStroke(playerId, input.stepId, input.stroke),
      { rateLimit: false },
    )
    bindRequest(
      socket,
      EVENTS.relayDrawFillCommit,
      (input, playerId) => relayDrawingService.addFill(playerId, input.stepId, input.fill),
      { rateLimit: false },
    )
    bindRequest(
      socket,
      EVENTS.relayDrawUndo,
      (input, playerId) => relayDrawingService.undo(playerId, input.stepId),
      { rateLimit: false },
    )
    bindRequest(
      socket,
      EVENTS.relayDrawRedo,
      (input, playerId) => relayDrawingService.redo(playerId, input.stepId),
      { rateLimit: false },
    )
    bindRequest(
      socket,
      EVENTS.relayDrawClear,
      (input, playerId) => relayDrawingService.clear(playerId, input.stepId),
      { rateLimit: false },
    )
  }
}
