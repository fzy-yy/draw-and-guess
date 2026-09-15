import type { z } from 'zod'
import type { DrawPointSchema, FillCommandSchema, StrokeSchema } from '../protocol/drawing.ts'
import type { DrawingCommandSchema, ServerPushData } from '../protocol/push.ts'
import type { StrokeAckSchema } from '../protocol/response.ts'
import type { EVENTS } from '../events.ts'

export type DrawPoint = z.infer<typeof DrawPointSchema>
export type Stroke = z.infer<typeof StrokeSchema>
export type FillCommand = z.infer<typeof FillCommandSchema>
export type DrawingCommand = z.infer<typeof DrawingCommandSchema>

/** 笔画批次 ack 的成功数据由响应 Schema 推导。 */
export type StrokeAck = z.infer<typeof StrokeAckSchema>

export type StrokePush = ServerPushData<typeof EVENTS.drawStrokeBatch>
export type FillPush = ServerPushData<typeof EVENTS.drawFillCommit>
export type DrawingPushContext = Omit<StrokePush, 'stroke'>
