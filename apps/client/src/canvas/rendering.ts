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
  // 归一化坐标 [0,1] 映射到像素 [0, canvas-1]：末列/末行索引是 canvas-1。
  // 若乘 canvasWidth 会把 x=1 画到 canvasWidth 处（越过最后一个像素），
  // 与 GameCanvas 画填充种子时 clamp 到 canvas-1 不一致（见 docs/adr/0003-canvas-coordinate-bounds.md）。
  context.moveTo(first.x * (canvasWidth - 1), first.y * (canvasHeight - 1))
  for (const point of stroke.points.slice(start + 1))
    context.lineTo(point.x * (canvasWidth - 1), point.y * (canvasHeight - 1))
  if (stroke.points.length === 1)
    context.lineTo(first.x * (canvasWidth - 1) + 0.01, first.y * (canvasHeight - 1) + 0.01)
  else if (start >= 1 && stroke.points.length - start === 1 && stroke.points[start - 1]) {
    const previous = stroke.points[start - 1]!
    context.lineTo(
      previous.x * (canvasWidth - 1) + (first.x - previous.x) * (canvasWidth - 1) + 0.01,
      previous.y * (canvasHeight - 1) + (first.y - previous.y) * (canvasHeight - 1) + 0.01,
    )
  }
  context.stroke()
  context.restore()
}
