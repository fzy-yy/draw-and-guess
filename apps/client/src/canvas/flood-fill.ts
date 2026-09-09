import { APP_CONFIG } from '@draw-guess/config'

export type Rgba = readonly [number, number, number, number]

export interface FloodFillMetrics {
  filledPixels: number
  pushedSpans: number
  peakWorkingBytes: number
}

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
export function applyFloodFillMeasured(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  replacement: Rgba,
  tolerance = APP_CONFIG.drawing.fillTolerance,
): FloodFillMetrics {
  if (width <= 0 || height <= 0 || data.length !== width * height * 4)
    return { filledPixels: 0, pushedSpans: 0, peakWorkingBytes: 0 }
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
    return { filledPixels: 0, pushedSpans: 0, peakWorkingBytes: 0 }

  // 扫描线只压入相邻行的连续 span 种子。常见空白画布的栈深接近 1；复杂图形按需扩容，
  // 避免旧 BFS 固定分配 width*height 个 Int32（720p 约 3.5 MiB）。
  const pixelCount = width * height
  let stack = new Int32Array(Math.min(pixelCount, Math.max(64, width * 2)))
  let stackSize = 0
  let pushedSpans = 0
  let peakWorkingBytes = stack.byteLength
  const push = (pixelIndex: number): void => {
    if (stackSize >= stack.length) {
      const next = new Int32Array(Math.min(pixelCount, stack.length * 2))
      peakWorkingBytes = Math.max(peakWorkingBytes, stack.byteLength + next.byteLength)
      next.set(stack)
      stack = next
    }
    stack[stackSize] = pixelIndex
    stackSize += 1
    pushedSpans += 1
  }

  const blendAntialiasPixel = (pixelX: number, pixelY: number): void => {
    if (pixelX < 0 || pixelX >= width || pixelY < 0 || pixelY >= height) return
    const offset = (pixelY * width + pixelX) * 4
    if (pixelMatches(data, offset, target, tolerance)) return
    const alpha = data[offset + 3] ?? 0
    if (alpha <= 0 || alpha >= 255) return
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

  const scanNeighborRow = (rowY: number, left: number, right: number): void => {
    if (rowY < 0 || rowY >= height) return
    // 只对 span 周围一像素的边界带执行原 9 邻域抗锯齿垫底语义。
    for (let x = left - 1; x <= right + 1; x += 1) blendAntialiasPixel(x, rowY)
    let inTargetRun = false
    for (let x = left; x <= right; x += 1) {
      const matches = pixelMatches(data, (rowY * width + x) * 4, target, tolerance)
      if (matches && !inTargetRun) push(rowY * width + x)
      inTargetRun = matches
    }
  }

  let filledPixels = 0
  push(startIndex)
  while (stackSize > 0) {
    stackSize -= 1
    const seed = stack[stackSize]!
    const seedY = Math.floor(seed / width)
    const seedX = seed % width
    if (!pixelMatches(data, seed * 4, target, tolerance)) continue

    let left = seedX
    let right = seedX
    while (left > 0 && pixelMatches(data, (seedY * width + left - 1) * 4, target, tolerance))
      left -= 1
    while (
      right + 1 < width &&
      pixelMatches(data, (seedY * width + right + 1) * 4, target, tolerance)
    )
      right += 1

    for (let x = left; x <= right; x += 1) {
      setPixel(data, (seedY * width + x) * 4, replacement)
      filledPixels += 1
    }
    blendAntialiasPixel(left - 1, seedY)
    blendAntialiasPixel(right + 1, seedY)
    scanNeighborRow(seedY - 1, left, right)
    scanNeighborRow(seedY + 1, left, right)
  }

  peakWorkingBytes = Math.max(peakWorkingBytes, stack.byteLength)
  return { filledPixels, pushedSpans, peakWorkingBytes }
}

/** 兼容既有调用：只返回填充像素数。 */
export function applyFloodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  replacement: Rgba,
  tolerance = APP_CONFIG.drawing.fillTolerance,
): number {
  return applyFloodFillMeasured(data, width, height, startX, startY, replacement, tolerance)
    .filledPixels
}
