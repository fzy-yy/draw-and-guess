import type { Stroke } from '@draw-guess/shared'
import { APP_CONFIG } from '@draw-guess/config'

/** 重放服务端确认的归一化直线段命令；不依赖 Vue 状态或 DOM 生命周期。 */
export function renderStroke(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
  fromIndex = 0,
): void {
  if (!stroke.points.length) return
  const canvasWidth = context.canvas.width
  const canvasHeight = context.canvas.height
  const scale = Math.min(canvasWidth, canvasHeight) / APP_CONFIG.drawing.referenceResolution
  context.save()
  context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
  context.strokeStyle = stroke.color
  context.lineWidth = stroke.width * Math.max(APP_CONFIG.drawing.minLineScale, scale)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  const start = Math.max(0, fromIndex - 1)
  const first = stroke.points[start]
  if (!first) {
    context.restore()
    return
  }
  context.moveTo(first.x * canvasWidth, first.y * canvasHeight)
  for (const point of stroke.points.slice(start + 1))
    context.lineTo(point.x * canvasWidth, point.y * canvasHeight)
  if (stroke.points.length === 1)
    context.lineTo(first.x * canvasWidth + 0.01, first.y * canvasHeight + 0.01)
  else if (start >= 1 && stroke.points.length - start === 1 && stroke.points[start - 1]) {
    const previous = stroke.points[start - 1]!
    context.lineTo(
      previous.x * canvasWidth + (first.x - previous.x) * canvasWidth + 0.01,
      previous.y * canvasHeight + (first.y - previous.y) * canvasHeight + 0.01,
    )
  }
  context.stroke()
  context.restore()
}
