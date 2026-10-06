import { z } from 'zod'
import { DRAWING_PROTOCOL_LIMITS } from './constants.ts'

export const DrawPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})
const DrawStyleSchema = {
  color: z.string().regex(new RegExp(DRAWING_PROTOCOL_LIMITS.colorPattern)),
  width: z
    .number()
    .min(DRAWING_PROTOCOL_LIMITS.width.min)
    .max(DRAWING_PROTOCOL_LIMITS.width.max)
    .multipleOf(DRAWING_PROTOCOL_LIMITS.width.step),
  sequence: z.number().int().nonnegative(),
}
export const StrokeSchema = z.object({
  kind: z.literal('stroke'),
  id: z.string().min(4).max(64),
  tool: z.enum(['pen', 'eraser']),
  ...DrawStyleSchema,
  points: z.array(DrawPointSchema).min(1).max(DRAWING_PROTOCOL_LIMITS.maxPointsPerStroke),
  startPointIndex: z.number().int().nonnegative().optional(),
})

/** 单次绘图请求仅容纳一个批次；完整 StrokeSchema 则用于累积历史与快照。 */
export const StrokeBatchSchema = StrokeSchema.extend({
  points: z.array(DrawPointSchema).min(1).max(DRAWING_PROTOCOL_LIMITS.maxPointsPerBatch),
})
export const FillCommandSchema = z.object({
  kind: z.literal('fill'),
  id: z.string().min(4).max(64),
  point: DrawPointSchema,
  color: z.string().regex(new RegExp(DRAWING_PROTOCOL_LIMITS.colorPattern)),
  sequence: z.number().int().nonnegative(),
})
