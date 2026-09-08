import type { z } from 'zod'
import type { DrawPointSchema, FillCommandSchema, StrokeSchema } from '../protocol/drawing.ts'
import type { DrawingCommandSchema, ServerPushData } from '../protocol/push.ts'
import type { EVENTS } from '../events.ts'

export type DrawPoint = z.infer<typeof DrawPointSchema>
export type Stroke = z.infer<typeof StrokeSchema>
export type FillCommand = z.infer<typeof FillCommandSchema>
export type DrawingCommand = z.infer<typeof DrawingCommandSchema>

export interface StrokeAck {
  strokeId: string
  pointCount: number
  drawingRevision: number
  remainingBudget: number
}

export type StrokePush = ServerPushData<typeof EVENTS.drawStrokeBatch>
export type FillPush = ServerPushData<typeof EVENTS.drawFillCommit>
export type DrawingPushContext = Omit<StrokePush, 'stroke'>
