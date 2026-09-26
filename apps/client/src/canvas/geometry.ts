/**
 * 画布坐标几何单口径（ADR-0022；约定源头见 ADR-0003）。
 *
 * 「归一化 [0,1] ↔ 逻辑栅格」映射、栅格索引 clamp 与「光标直径 ≡ 落笔线宽」恒等式
 * 曾逐字复制在描边渲染、填充种子、洪泛像素种子、e2e 探针、光标计算五处，一致性只靠
 * 注释互指守护。本模块是这些公式的唯一出处：产品 canvas 层、composables 与 Playwright
 * 探针（Node 端）共用同一实现——e2e 浏览器上下文不再保留第二份映射副本。
 *
 * 本模块刻意**零 import**（连 @draw-guess/config 都不引用）：洪泛 Worker 独立 bundle 与
 * 探针 Node 上下文都要直接引用它，携带配置包 barrel 会把 zod 与全量 schema 拖进独立
 * chunk（AGENTS「独立 bundle 的轻量导入约束」）；minLineScale 等参数由调用方传入。
 */

/**
 * 单点圆点补偿：本段只有一个点可画（首点起笔、单点批次或预览已追平）时，moveTo 之后
 * 没有 lineTo 不产生任何像素；补一段微小偏移让 round 线帽把该点渲染成圆点。
 * 数值成文为常量（旧实现是散落的裸 `+0.01` 字面量）。
 */
export const SINGLE_POINT_DOT_EPSILON = 0.01

/**
 * 归一化坐标映射到逻辑栅格轴（连续值、不取整）：`[0,1] → [0, size-1]`。
 * 乘 `size` 会把 x=1 画到越出末列的位置，与栅格末列索引 size-1 不一致（ADR-0003）；
 * 描边路径用连续值，交由 canvas 反锯齿处理亚像素。
 */
export function logicalAxis(value: number, size: number): number {
  return value * (size - 1)
}

/** 把任意像素轴坐标收敛进合法栅格索引 `[0, size-1]`（先 round 再 clamp）。 */
export function clampPixelAxis(pixel: number, size: number): number {
  return Math.max(0, Math.min(size - 1, Math.round(pixel)))
}

/** 归一化坐标直接落到栅格索引（填充种子、探针采样）：round + clamp 的合成口径。 */
export function normalizedToPixelIndex(value: number, size: number): number {
  return clampPixelAxis(logicalAxis(value, size), size)
}

/**
 * 线宽/光标直径恒等式：`宽度 × max(minLineScale, scale)`。
 * 渲染侧传逻辑栅格 scale、光标侧传 CSS scale——两处必须共用本公式，
 * 「看到的圆点 ≡ 画出的笔画」这条跨 CSS↔栅格的恒等才有一处真源。
 */
export function strokeWidthAt(width: number, scale: number, minLineScale: number): number {
  return width * Math.max(minLineScale, scale)
}
