/**
 * 客户端请求响应的统一运行时解码与脱敏诊断记录（与 `push-protocol.ts` 对称）。
 *
 * `createRequester` 的每次 `emitWithAck` 结果都必须先经这里 safeParse：
 * - Schema 解析失败（malformed success、未知错误码、缺 requestId 等）→ `invalid_payload`；
 * - requestId 与本次请求不一致 → `request_id_mismatch`（防止迟到/串线 ack 被当成当前结果）。
 *
 * 诊断只记录事件、原因与时间：不保留 payload、响应 data、错误文案、requestId 值或任何可复现内容。
 * 有界列表与 Zod 问题格式化统一取自 `utils/bounded-diagnostics.ts`。
 * 边界设计与取舍见 docs/adr/0012-ack-runtime-boundary.md。
 */
import {
  CLIENT_RESPONSE_SCHEMAS,
  type ClientRequestEvent,
  type ClientResponseAck,
} from '@draw-guess/shared'
import { createBoundedDiagnostics, describeZodIssues } from '@/utils/bounded-diagnostics'

type InvalidResponseReason = 'invalid_payload' | 'request_id_mismatch'

interface ResponseDiagnostic {
  event: ClientRequestEvent
  reason: string
  receivedAt: number
}

const diagnostics = createBoundedDiagnostics<ResponseDiagnostic>()

type DecodeClientResponseResult<E extends ClientRequestEvent> =
  | { status: 'valid'; ack: ClientResponseAck<E> }
  | { status: 'invalid'; reason: InvalidResponseReason }

export function decodeClientResponse<E extends ClientRequestEvent>(
  event: E,
  raw: unknown,
  expectedRequestId: string,
): DecodeClientResponseResult<E> {
  const result = CLIENT_RESPONSE_SCHEMAS[event].safeParse(raw)
  if (!result.success) {
    diagnostics.record({
      event,
      reason: describeZodIssues(result.error.issues),
      receivedAt: Date.now(),
    })
    return { status: 'invalid', reason: 'invalid_payload' }
  }
  if (result.data.requestId !== expectedRequestId) {
    diagnostics.record({ event, reason: 'requestId:mismatch', receivedAt: Date.now() })
    return { status: 'invalid', reason: 'request_id_mismatch' }
  }
  // Schema 实例与目标类型来自同一映射表同一条目；TypeScript 无法在泛型下标访问上
  // 归一化 zod 的 output<> 推导，这里的标注不引入任何运行时误差。
  return { status: 'valid', ack: result.data as ClientResponseAck<E> }
}

/**
 * 诊断读取接缝：供测试断言与未来诊断 UI 预留，生产暂无消费者。
 * 只暴露副本，避免诊断 UI 或测试修改内部记录；请勿因「看不到调用方」而删除。
 */
export function getResponseDiagnostics(): readonly ResponseDiagnostic[] {
  return diagnostics.list()
}

/** 与 getResponseDiagnostics 配对：测试用例间重置全局诊断列表的唯一入口。 */
export function clearResponseDiagnostics(): void {
  diagnostics.clear()
}
