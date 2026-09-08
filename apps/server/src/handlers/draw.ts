/**
 * 绘图事件处理器：笔画批次、区域填充、撤销/重做/清空。
 * 全部跳过通用限频（bindRequest rateLimit: false），绘图有服务端专用的 45/s 滑动窗口限频。
 */
import { CLIENT_REQUEST_SCHEMAS, EVENTS } from '@draw-guess/shared'
import { bindRequest } from '../protocol/binder.ts'
import type { GameService } from '../game-service.ts'

/** 注册绘图相关请求事件。 */
export function registerDrawHandlers(
  socket: import('socket.io').Socket,
  service: GameService,
): void {
  bindRequest(
    socket,
    EVENTS.drawStrokeBatch,
    CLIENT_REQUEST_SCHEMAS[EVENTS.drawStrokeBatch],
    (input, playerId) => service.addStroke(playerId, input.roundId, input.stroke),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawFillCommit,
    CLIENT_REQUEST_SCHEMAS[EVENTS.drawFillCommit],
    (input, playerId) => service.addFill(playerId, input.roundId, input.fill),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawUndo,
    CLIENT_REQUEST_SCHEMAS[EVENTS.drawUndo],
    (input, playerId) => service.undo(playerId, input.roundId),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawRedo,
    CLIENT_REQUEST_SCHEMAS[EVENTS.drawRedo],
    (input, playerId) => service.redo(playerId, input.roundId),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawClear,
    CLIENT_REQUEST_SCHEMAS[EVENTS.drawClear],
    (input, playerId) => service.clearDrawing(playerId, input.roundId),
    { rateLimit: false },
  )
}
