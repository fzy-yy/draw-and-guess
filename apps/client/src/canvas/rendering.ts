import type { Stroke } from '@draw-guess/shared'
import { APP_CONFIG } from '@draw-guess/config'
import { SINGLE_POINT_DOT_EPSILON, logicalAxis, strokeWidthAt } from './geometry'

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
  // 线宽与光标直径共用同一恒等式（geometry 单口径，ADR-0022）。
  context.lineWidth = strokeWidthAt(stroke.width, scale, APP_CONFIG.drawing.minLineScale)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  // 增量描边必须回退到上一个已画点起笔（fromIndex - 1）：新增首段要与已画折线的尾点
  // 共享端点才能物理相连；直接从 fromIndex 起笔会让第一段悬空，新旧线段断开——
  // 这正是历史白边/断线缺陷的防回潮点（ADR-0018 尾部增量补画依赖此口径）。
  const start = Math.max(0, fromIndex - 1)
  const first = stroke.points[start]
  if (!first) {
    context.restore()
    return
  }
  // 归一化 [0,1] → 像素 [0, size-1] 的映射口径见 geometry.logicalAxis（ADR-0003）；
  // 描边取连续值，亚像素交给 canvas 反锯齿。
  const firstX = logicalAxis(first.x, canvasWidth)
  const firstY = logicalAxis(first.y, canvasHeight)
  context.moveTo(firstX, firstY)
  for (const point of stroke.points.slice(start + 1))
    context.lineTo(logicalAxis(point.x, canvasWidth), logicalAxis(point.y, canvasHeight))
  // 本段只有一个点可画（首点，或本批仅新增 1 点/本地预览已追平）时，moveTo 后没有 lineTo
  // 不会产生任何像素；补微小偏移（SINGLE_POINT_DOT_EPSILON）让 round 线帽渲染成圆点。
  if (stroke.points.length - start === 1)
    context.lineTo(firstX + SINGLE_POINT_DOT_EPSILON, firstY + SINGLE_POINT_DOT_EPSILON)
  context.stroke()
  context.restore()
}
