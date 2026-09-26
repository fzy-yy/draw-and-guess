/**
 * 洪泛填充执行的脱敏诊断：只保留「发生了什么」与时间戳，不记录坐标、颜色、像素或答案。
 * 有界列表与脱敏白名单统一取自 `utils/bounded-diagnostics.ts`，排障时与推送/响应诊断可对照。
 * 记录上限固定，避免极端反复失败时无界增长（见 docs/adr/0009-fill-degradation-and-locks.md）。
 */
import { createBoundedDiagnostics } from '@/utils/bounded-diagnostics'

export type FillDiagnosticReason =
  /** Worker 运行失败、由主线程对同一 ImageData 降级成功：画布结果正确，但线程已被终止重建。 */
  | 'worker_degraded'
  /** 这次填充无法在本地完成（Worker 与主线程降级都失败，或结果无法写回）：需要请求权威全量快照。 */
  | 'fill_unavailable'

export interface FillDiagnostic {
  reason: FillDiagnosticReason
  receivedAt: number
}

const diagnostics = createBoundedDiagnostics<FillDiagnostic>()

export function recordFillDiagnostic(reason: FillDiagnosticReason): void {
  diagnostics.record({ reason, receivedAt: Date.now() })
}

/** 只暴露副本，避免诊断 UI 或测试修改内部记录。 */
export function getFillDiagnostics(): readonly FillDiagnostic[] {
  return diagnostics.list()
}

export function clearFillDiagnostics(): void {
  diagnostics.clear()
}
