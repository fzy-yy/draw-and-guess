/** 计算固定短边逻辑分辨率的 Canvas backing size，独立于 Vue 生命周期。 */
export function getCanvasBackingSize(
  width: number,
  height: number,
  referenceResolution: number,
): { width: number; height: number } {
  const shortSide = Math.max(1, Math.min(width, height))
  const ratio = referenceResolution / shortSide
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

/** DOM 展示层按 CSS 像素与封顶 DPR 分配 backing store，不影响权威逻辑栅格。 */
export function getDisplayCanvasSize(
  width: number,
  height: number,
  devicePixelRatio: number,
  devicePixelRatioCap: number,
): { width: number; height: number; scale: number } {
  const normalizedDpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const scale = Math.min(normalizedDpr, devicePixelRatioCap)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

/** 把固定逻辑栅格投影到展示层；关闭平滑避免二次插值模糊边缘和填充边界。 */
export function presentLogicalCanvas(
  logicalCanvas: HTMLCanvasElement,
  displayCanvas: HTMLCanvasElement,
): void {
  const context = displayCanvas.getContext('2d')
  if (!context) return
  context.imageSmoothingEnabled = false
  context.save()
  context.clearRect(0, 0, displayCanvas.width, displayCanvas.height)
  context.drawImage(logicalCanvas, 0, 0, displayCanvas.width, displayCanvas.height)
  context.restore()
  context.imageSmoothingEnabled = false
}
