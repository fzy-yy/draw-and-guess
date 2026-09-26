/**
 * 有界诊断列表与 Zod 问题格式化：客户端多处「有界、副本导出、可清空」诊断的统一内核。
 *
 * 为什么存在：请求响应（`stores/response-protocol.ts`）、主动推送（`stores/push-protocol.ts`）
 * 与填充执行（`canvas/fill-diagnostics.ts`）各写过一份同样的有界数组 + 副本导出 + 清空，
 * 以及同一套「只记字段路径与错误类别」的脱敏格式化。集中在此后：
 * - 记录上限、副本语义与清空行为只有一处；
 * - 脱敏白名单只有一处，绝不写入被拒绝的原始值（见 docs/adr/0026-client-diagnostics-core.md）。
 */
export interface BoundedDiagnostics<T> {
  /** 追加一条记录；超过上限时丢弃最旧的一条。 */
  record(entry: T): void
  /** 返回副本数组，避免调用方改写内部记录。 */
  list(): readonly T[]
  clear(): void
}

/** 创建一个有界诊断列表；默认上限 20，防止反复失败时无界增长。 */
export function createBoundedDiagnostics<T extends object>(max = 20): BoundedDiagnostics<T> {
  const entries: T[] = []
  return {
    record(entry) {
      entries.push(entry)
      if (entries.length > max) entries.shift()
    },
    list() {
      return entries.map((entry) => ({ ...entry }))
    },
    clear() {
      entries.length = 0
    },
  }
}

interface IssueLike {
  path: PropertyKey[]
  code: string
  /** Zod 联合分支失败时嵌套的细粒度问题；诊断需要下钻到具体字段。 */
  errors?: unknown
}

/**
 * 展开联合类型的分支问题：只保留字段路径与 Zod 错误类别，绝不写入被拒绝的原始值。
 * 不做展开时根级 `invalid_union` 无法定位到底是哪个字段损坏。
 */
function collectIssues(
  issues: ReadonlyArray<IssueLike>,
  depth = 0,
): Array<{ path: PropertyKey[]; code: string }> {
  const collected: Array<{ path: PropertyKey[]; code: string }> = []
  for (const issue of issues) {
    const nested = Array.isArray(issue.errors) ? (issue.errors as unknown[]).flat() : []
    if (nested.length > 0 && depth < 2) {
      collected.push(...collectIssues(nested as IssueLike[], depth + 1))
      continue
    }
    collected.push({ path: issue.path, code: issue.code })
  }
  return collected
}

/** 把 Zod 问题格式化为 `path:code` 列表（最多 3 条），只含路径与错误类别。 */
export function describeZodIssues(issues: ReadonlyArray<IssueLike>): string {
  return collectIssues(issues)
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '<root>'}:${issue.code}`)
    .join(',')
}
