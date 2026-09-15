/**
 * 洪泛填充执行的脱敏诊断：只保留「发生了什么」与时间戳，不记录坐标、颜色、像素或答案。
 * 与 stores/push-protocol.ts 的推送诊断同构（有界、只读导出、可清空），排障时两者可对照。
 * 记录上限固定，避免极端反复失败时无界增长（见 docs/adr/0009-fill-degradation-and-locks.md）。
 */
export type FillDiagnosticReason =
  /** Worker 运行失败、由主线程对同一 ImageData 降级成功：画布结果正确，但线程已被终止重建。 */
  | 'worker_degraded'
  /** 这次填充无法在本地完成（Worker 与主线程降级都失败，或结果无法写回）：需要请求权威全量快照。 */
  | 'fill_unavailable'

export interface FillDiagnostic {
  reason: FillDiagnosticReason
  receivedAt: number
}

const MAX_DIAGNOSTICS = 20
const diagnostics: FillDiagnostic[] = []

export function recordFillDiagnostic(reason: FillDiagnosticReason): void {
  diagnostics.push({ reason, receivedAt: Date.now() })
  if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift()
}

/** 只暴露副本，避免诊断 UI 或测试修改内部记录。 */
export function getFillDiagnostics(): readonly FillDiagnostic[] {
  return diagnostics.map((item) => ({ ...item }))
}

export function clearFillDiagnostics(): void {
  diagnostics.length = 0
}
