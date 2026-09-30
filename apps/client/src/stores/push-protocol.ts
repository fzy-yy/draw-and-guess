/** 服务端主动推送的统一运行时解码与脱敏诊断记录。 */
import { APP_CONFIG } from '@draw-guess/config'
import {
  SERVER_PUSH_SCHEMAS,
  type ServerPushData,
  type ServerPushEventName,
} from '@draw-guess/shared'
import { createBoundedDiagnostics, describeZodIssues } from '@/utils/bounded-diagnostics'

export type InvalidPushReason = 'invalid_payload' | 'protocol_mismatch'

export interface ProtocolDiagnostic {
  event: ServerPushEventName
  reason: string
  receivedAt: number
}

const diagnostics = createBoundedDiagnostics<ProtocolDiagnostic>()

export type DecodeServerPushResult<E extends ServerPushEventName> =
  { ok: true; data: ServerPushData<E> } | { ok: false; reason: InvalidPushReason }

export function decodeServerPush<E extends ServerPushEventName>(
  event: E,
  raw: unknown,
): DecodeServerPushResult<E> {
  const result = SERVER_PUSH_SCHEMAS[event].safeParse(raw)
  if (result.success) return { ok: true, data: result.data.data }

  const receivedProtocolVersion =
    typeof raw === 'object' && raw !== null && 'protocolVersion' in raw
      ? raw.protocolVersion
      : undefined
  const reason: InvalidPushReason =
    receivedProtocolVersion !== undefined &&
    receivedProtocolVersion !== APP_CONFIG.app.protocolVersion
      ? 'protocol_mismatch'
      : 'invalid_payload'

  diagnostics.record({
    event,
    reason:
      reason === 'protocol_mismatch'
        ? 'protocolVersion:mismatch'
        : describeZodIssues(result.error.issues),
    receivedAt: Date.now(),
  })
  return { ok: false, reason }
}

/**
 * 诊断读取接缝：供测试断言与未来诊断 UI 预留，生产暂无消费者。
 * 只暴露副本，避免诊断 UI 或测试修改内部记录；请勿因「看不到调用方」而删除。
 */
export function getProtocolDiagnostics(): readonly ProtocolDiagnostic[] {
  return diagnostics.list()
}

/** 与 getProtocolDiagnostics 配对：测试用例间重置全局诊断列表的唯一入口。 */
export function clearProtocolDiagnostics(): void {
  diagnostics.clear()
}
