/**
 * 绘图事件处理器：笔画批次、区域填充、撤销/重做/清空。
 * 全部跳过通用限频（bindRequest rateLimit: false），绘图有服务端专用的 45/s 滑动窗口限频。
 */
import { z } from 'zod'
import { EVENTS, FillCommandSchema, RequestSchema, StrokeSchema } from '@draw-guess/shared'
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
    RequestSchema.extend({ roundId: z.string().uuid(), stroke: StrokeSchema }),
    (input, playerId) => service.addStroke(playerId, input.roundId, input.stroke),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawFillCommit,
    RequestSchema.extend({ roundId: z.string().uuid(), fill: FillCommandSchema }),
    (input, playerId) => service.addFill(playerId, input.roundId, input.fill),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawUndo,
    RequestSchema.extend({ roundId: z.string().uuid() }),
    (input, playerId) => service.undo(playerId, input.roundId),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawRedo,
    RequestSchema.extend({ roundId: z.string().uuid() }),
    (input, playerId) => service.redo(playerId, input.roundId),
    { rateLimit: false },
  )
  bindRequest(
    socket,
    EVENTS.drawClear,
    RequestSchema.extend({ roundId: z.string().uuid() }),
    (input, playerId) => service.clearDrawing(playerId, input.roundId),
    { rateLimit: false },
  )
}
