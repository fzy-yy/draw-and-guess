import type { Locator } from '@playwright/test'
import { normalizedToPixelIndex } from '../../../apps/client/src/canvas/geometry'

/**
 * 逻辑画布探针（E2E 专用）。
 *
 * 生产构建默认不暴露逻辑层；launcher 以 `VITE_EXPOSE_LOGICAL_CANVAS=1` 构建前端，
 * 使 `useCanvasViewport` 把离屏逻辑画布挂到展示层 canvas 的 `__logicalCanvas` 上。
 * 指纹实现集中在此，避免各 spec 各写一份哈希（同一条权威历史必须可跨端比对）。
 *
 * 采样口径单源（ADR-0022）：浏览器端 evaluate 只负责读栅格——整块 FNV 指纹 + 指定行
 * 的像素带；采样行列索引由 Node 端 geometry.ts 的 `normalizedToPixelIndex` 计算，
 * 归一化→像素映射在浏览器上下文**零副本**。`stableSampleHash` 的格式（三个采样点
 * RGBA 十六进制串联）与跨客户端可对比语义保持不变。
 * 注意：evaluate 回调会被序列化进浏览器执行，其自由变量（模块级函数/import）不会
 * 跨越边界——DOM 取层样板因此内联在两处回调里；几何公式则只在 Node 端求值。
 */
export interface LogicalRaster {
  /** 整块逻辑栅格的 FNV-1a 指纹：同一条权威历史在任何客户端都必须得到同一个值。 */
  hash: string
  /** 固定采样点（左中/中/右中）的颜色，用于捕捉「填充是否越界」这类结构性差异。 */
  stableSampleHash: string
  width: number
  height: number
}

export async function readLogicalRaster(target: Locator): Promise<LogicalRaster> {
  // 第一趟只取尺寸：采样行/列索引必须在 Node 端算（映射公式的唯一出处在 geometry.ts）。
  const size = await target.evaluate((element) => {
    const logical = (element as HTMLCanvasElement & { __logicalCanvas?: HTMLCanvasElement })
      .__logicalCanvas
    if (!logical) throw new Error('逻辑画布未挂载')
    return { width: logical.width, height: logical.height }
  })
  const bandRow = normalizedToPixelIndex(0.5, size.height)
  const { hash, rowBand } = await target.evaluate((element, band) => {
    const logical = (element as HTMLCanvasElement & { __logicalCanvas?: HTMLCanvasElement })
      .__logicalCanvas
    if (!logical) throw new Error('逻辑画布未挂载')
    const context = logical.getContext('2d', { willReadFrequently: true })!
    const data = context.getImageData(0, 0, logical.width, logical.height).data
    let fnv = 0x811c9dc5
    for (const byte of data) {
      fnv ^= byte
      fnv = Math.imul(fnv, 0x01000193)
    }
    const bandData = context.getImageData(0, band, logical.width, 1).data
    return { hash: (fnv >>> 0).toString(16).padStart(8, '0'), rowBand: [...bandData] }
  }, bandRow)

  const sample = (x: number) => {
    const column = normalizedToPixelIndex(x, size.width)
    return rowBand
      .slice(column * 4, column * 4 + 4)
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')
  }
  return {
    hash,
    stableSampleHash: [sample(0.2), sample(0.5), sample(0.8)].join('-'),
    width: size.width,
    height: size.height,
  }
}
