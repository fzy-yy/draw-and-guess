import { clampPixelAxis } from './geometry'

export type Rgba = readonly [number, number, number, number]

interface FloodFillMetrics {
  filledPixels: number
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
 * tolerance 由调用方显式传入（配置单一来源仍是 @draw-guess/config 的 drawing.fillTolerance）：
 * 本模块同时被 Worker bundle 引用，不能依赖配置包 barrel，否则会把 zod 与全量 schema 拖进独立 chunk。
 */
export function applyFloodFillMeasured(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  replacement: Rgba,
  tolerance: number,
): FloodFillMetrics {
  if (width <= 0 || height <= 0 || data.length !== width * height * 4)
    return { filledPixels: 0, peakWorkingBytes: 0 }
  // 像素种子 clamp 到合法栅格索引（口径单源，geometry/ADR-0022）。
  const x = clampPixelAxis(startX, width)
  const y = clampPixelAxis(startY, height)
  const startIndex = y * width + x
  const startOffset = startIndex * 4
  const target: Rgba = [
    data[startOffset] ?? 0,
    data[startOffset + 1] ?? 0,
    data[startOffset + 2] ?? 0,
    data[startOffset + 3] ?? 0,
  ]
  // target 由 data 的 4 通道构造、replacement 恒为 Rgba 四元组，every 的 index ∈ [0,4) 必命中；
  // noUncheckedIndexedAccess 下元组数字索引带 undefined，用 ?? 0 兜底（该分支运行时不可达）替代 `!`。
  if (target.every((channel, index) => Math.abs(channel - (replacement[index] ?? 0)) <= tolerance))
    return { filledPixels: 0, peakWorkingBytes: 0 }

  // 扫描线只压入相邻行的连续 span 种子。常见空白画布的栈深接近 1；复杂图形按需扩容，
  // 避免旧 BFS 固定分配 width*height 个 Int32（720p 约 3.5 MiB）。
  //
  // 容量以 pixelCount 封顶（下方两处 Math.min）的安全性论证【待人工确认】：纸面推导
  // 不能证明「压入次数 ≤ 像素数」——每个未填充像素可分别被上、下相邻行的 span 各作为
  // run 起点压入一次（同一行被弹出的 run 互相不重叠、填充后不再满足 target），两份
  // 重复种子可同时悬空；且 blendAntialiasPixel 垫底在极端取值下理论上能把边缘像素
  // 带回 target 容差内，run 起点并非严格一次性消费。「瞬时栈深 ≤ pixelCount」依赖
  // LIFO 弹出与重复压入的交错顺序，无简单不变量可证。现状保留封顶、不加运行时断言
  // （热点循环成本零变化）：若真超限，越界写入被 TypedArray 静默忽略、丢种子的后果
  // 是漏填而非崩溃，观测口径可由 peakWorkingBytes 与基准脚本（scripts/benchmark-flood-fill.mts）核对。
  const pixelCount = width * height
  let stack = new Int32Array(Math.min(pixelCount, Math.max(64, width * 2)))
  let stackSize = 0
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
  }

  /**
   * 抗锯齿边界垫底：只处理「与填充区相邻的边界带像素」——它们是边界线与底色的
   * 半透明混合中间态，不满足 target 判等（不能直接吞进填充区），却又在填充区
   * 被替换后成为悬在半透明态的边缘。
   * 处理方式：按像素自身 alpha 作权重，与替换色混合后强制 alpha=255——
   * - 消掉抗锯齿过渡色滞留造成的白边 fringe（这类像素若原样保留，会在填充区
   *   与边界线之间留下一圈偏向底色的半透明过渡带）；
   * - 强制不透明，避免半透明像素在纸底色上留下透明洞。
   * alpha<=0（全透明，无混合价值）与 alpha>=255（真实边界线像素，不得改色）跳过。
   */
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
    // 热循环内 stackSize>0 已保证栈顶存在（Int32Array 定长栈，压弹严格配对）；
    // 改可选链/守卫会在每像素内层循环引入分支，收益为零、性能回退，故定点豁免。
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
  return { filledPixels, peakWorkingBytes }
}
