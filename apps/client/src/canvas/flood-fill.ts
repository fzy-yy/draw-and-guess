import { APP_CONFIG } from '@draw-guess/config'

export type Rgba = readonly [number, number, number, number]

export function colorToRgba(color: string): Rgba {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
    255,
  ]
}

function pixelMatches(
  data: Uint8ClampedArray,
  offset: number,
  target: Rgba,
  tolerance: number,
): boolean {
  return (
    Math.abs((data[offset] ?? 0) - target[0]) <= tolerance &&
    Math.abs((data[offset + 1] ?? 0) - target[1]) <= tolerance &&
    Math.abs((data[offset + 2] ?? 0) - target[2]) <= tolerance &&
    Math.abs((data[offset + 3] ?? 0) - target[3]) <= tolerance
  )
}

function setPixel(data: Uint8ClampedArray, offset: number, replacement: Rgba): void {
  data[offset] = replacement[0]
  data[offset + 1] = replacement[1]
  data[offset + 2] = replacement[2]
  data[offset + 3] = replacement[3]
}

/**
 * 对固定逻辑像素缓冲执行四方向洪泛填充。
 * 输入与结果都不依赖 DOM、CSS 尺寸或 DPR；同一历史在各浏览器使用相同 backing size 时结果一致。
 */
export function applyFloodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  replacement: Rgba,
  tolerance = APP_CONFIG.drawing.fillTolerance,
): number {
  if (width <= 0 || height <= 0 || data.length !== width * height * 4) return 0
  const x = Math.max(0, Math.min(width - 1, Math.round(startX)))
  const y = Math.max(0, Math.min(height - 1, Math.round(startY)))
  const startIndex = y * width + x
  const startOffset = startIndex * 4
  const target: Rgba = [
    data[startOffset] ?? 0,
    data[startOffset + 1] ?? 0,
    data[startOffset + 2] ?? 0,
    data[startOffset + 3] ?? 0,
  ]
  if (target.every((channel, index) => Math.abs(channel - replacement[index]!) <= tolerance))
    return 0

  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 1
  queue[0] = startIndex
  setPixel(data, startOffset, replacement)

  const enqueueIfTarget = (pixelIndex: number): void => {
    const offset = pixelIndex * 4
    if (!pixelMatches(data, offset, target, tolerance)) return
    setPixel(data, offset, replacement)
    queue[tail] = pixelIndex
    tail += 1
  }

  while (head < tail) {
    const pixelIndex = queue[head]!
    head += 1
    const pixelX = pixelIndex % width
    const pixelY = Math.floor(pixelIndex / width)
    if (pixelX > 0) enqueueIfTarget(pixelIndex - 1)
    if (pixelX + 1 < width) enqueueIfTarget(pixelIndex + 1)
    if (pixelY > 0) enqueueIfTarget(pixelIndex - width)
    if (pixelY + 1 < height) enqueueIfTarget(pixelIndex + width)
  }

  // 给填充区邻接的半透明抗锯齿像素垫底，不覆盖 alpha=255 的实心边界。
  for (let cursor = 0; cursor < tail; cursor += 1) {
    const pixelIndex = queue[cursor]!
    const pixelX = pixelIndex % width
    const pixelY = Math.floor(pixelIndex / width)
    for (let dy = -1; dy <= 1; dy += 1) {
      const neighborY = pixelY + dy
      if (neighborY < 0 || neighborY >= height) continue
      for (let dx = -1; dx <= 1; dx += 1) {
        const neighborX = pixelX + dx
        if (neighborX < 0 || neighborX >= width) continue
        const offset = (neighborY * width + neighborX) * 4
        if (pixelMatches(data, offset, target, tolerance)) continue
        const alpha = data[offset + 3] ?? 0
        if (alpha <= 0 || alpha >= 255) continue
        const foreground = alpha / 255
        const background = 1 - foreground
        data[offset] = Math.round((data[offset] ?? 0) * foreground + replacement[0] * background)
        data[offset + 1] = Math.round(
          (data[offset + 1] ?? 0) * foreground + replacement[1] * background,
        )
        data[offset + 2] = Math.round(
          (data[offset + 2] ?? 0) * foreground + replacement[2] * background,
        )
        data[offset + 3] = 255
      }
    }
  }
  return tail
}
