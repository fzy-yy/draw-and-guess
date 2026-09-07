export interface DrawPoint {
  x: number
  y: number
}
export interface Stroke {
  kind: 'stroke'
  id: string
  tool: 'pen' | 'eraser'
  color: string
  width: number
  points: DrawPoint[]
  sequence: number
  startPointIndex?: number
}
export interface StrokeAck {
  strokeId: string
  pointCount: number
  drawingRevision: number
  remainingBudget: number
}
export interface FillCommand {
  kind: 'fill'
  id: string
  point: DrawPoint
  color: string
  sequence: number
}
export interface DrawingPushContext {
  roomId: string
  gameId: string
  roundId: string
  drawingRevision: number
}
export type StrokePush = DrawingPushContext & { stroke: Stroke }
export type FillPush = DrawingPushContext & { fill: FillCommand }
export type DrawingCommand = Stroke | FillCommand
