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
