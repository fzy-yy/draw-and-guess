/**
 * 客户端请求响应的统一运行时解码与脱敏诊断记录（与 `push-protocol.ts` 对称）。
 *
 * `createRequester` 的每次 `emitWithAck` 结果都必须先经这里 safeParse：
 * - Schema 解析失败（malformed success、未知错误码、缺 requestId 等）→ `invalid_payload`；
 * - requestId 与本次请求不一致 → `request_id_mismatch`（防止迟到/串线 ack 被当成当前结果）。
 *
 * 诊断只记录事件、原因与时间：不保留 payload、响应 data、错误文案、requestId 值或任何可复现内容。
 * 边界设计与取舍见 docs/adr/0012-ack-runtime-boundary.md。
 */
import {
  CLIENT_RESPONSE_SCHEMAS,
  type ClientRequestEvent,
  type ClientResponseAck,
} from '@draw-guess/shared'

export type InvalidResponseReason = 'invalid_payload' | 'request_id_mismatch'

export interface ResponseDiagnostic {
  event: ClientRequestEvent
  reason: string
  receivedAt: number
}

const diagnostics: ResponseDiagnostic[] = []
const MAX_DIAGNOSTICS = 20

export type DecodeClientResponseResult<E extends ClientRequestEvent> =
  | { status: 'valid'; ack: ClientResponseAck<E> }
  | { status: 'invalid'; reason: InvalidResponseReason }

interface IssueLike {
  path: PropertyKey[]
  code: string
  /** Zod 联合分支失败时嵌套的细粒度问题；诊断需要下钻到具体字段。 */
  errors?: unknown
}

/**
 * 展开联合类型的分支问题：只保留字段路径与 Zod 错误类别，绝不写入被拒绝的原始值。
 * 不做展开时根级 `invalid_union` 无法定位到底是 data 还是 error.code 损坏。
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

function describeIssues(issues: ReadonlyArray<IssueLike>): string {
  return collectIssues(issues)
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '<root>'}:${issue.code}`)
    .join(',')
}

export function decodeClientResponse<E extends ClientRequestEvent>(
  event: E,
  raw: unknown,
  expectedRequestId: string,
): DecodeClientResponseResult<E> {
  const result = CLIENT_RESPONSE_SCHEMAS[event].safeParse(raw)
  if (!result.success) {
    diagnostics.push({
      event,
      reason: describeIssues(result.error.issues),
      receivedAt: Date.now(),
    })
    if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift()
    return { status: 'invalid', reason: 'invalid_payload' }
  }
  if (result.data.requestId !== expectedRequestId) {
    diagnostics.push({ event, reason: 'requestId:mismatch', receivedAt: Date.now() })
    if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift()
    return { status: 'invalid', reason: 'request_id_mismatch' }
  }
  // Schema 实例与目标类型来自同一映射表同一条目；TypeScript 无法在泛型下标访问上
  // 归一化 zod 的 output<> 推导，这里的标注不引入任何运行时误差。
  return { status: 'valid', ack: result.data as ClientResponseAck<E> }
}

/** 只暴露副本，避免诊断 UI 或测试修改内部记录。 */
export function getResponseDiagnostics(): readonly ResponseDiagnostic[] {
  return diagnostics.map((item) => ({ ...item }))
}

export function clearResponseDiagnostics(): void {
  diagnostics.length = 0
}
