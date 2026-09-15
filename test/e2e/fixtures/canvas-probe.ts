import type { Locator } from '@playwright/test'

/**
 * 逻辑画布探针（E2E 专用）。
 *
 * 生产构建默认不暴露逻辑层；launcher 以 `VITE_EXPOSE_LOGICAL_CANVAS=1` 构建前端，
 * 使 `useCanvasViewport` 把离屏逻辑画布挂到展示层 canvas 的 `__logicalCanvas` 上。
 * 指纹实现集中在此，避免各 spec 各写一份哈希（同一条权威历史必须可跨端比对）。
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
  return target.evaluate((element) => {
    const logical = (element as HTMLCanvasElement & { __logicalCanvas?: HTMLCanvasElement })
      .__logicalCanvas
    if (!logical) throw new Error('逻辑画布未挂载')
    const context = logical.getContext('2d', { willReadFrequently: true })!
    const data = context.getImageData(0, 0, logical.width, logical.height).data
    let hash = 0x811c9dc5
    for (const byte of data) {
      hash ^= byte
      hash = Math.imul(hash, 0x01000193)
    }
    const sample = (x: number, y: number) =>
      [
        ...context.getImageData(
          Math.round((logical.width - 1) * x),
          Math.round((logical.height - 1) * y),
          1,
          1,
        ).data,
      ]
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('')
    return {
      hash: (hash >>> 0).toString(16).padStart(8, '0'),
      stableSampleHash: [sample(0.2, 0.5), sample(0.5, 0.5), sample(0.8, 0.5)].join('-'),
      width: logical.width,
      height: logical.height,
    }
  })
}
