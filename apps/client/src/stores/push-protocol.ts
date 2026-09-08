/** 服务端主动推送的统一运行时解码与脱敏诊断记录。 */
import { APP_CONFIG } from '@draw-guess/config'
import {
  SERVER_PUSH_SCHEMAS,
  type ServerPushData,
  type ServerPushEventName,
} from '@draw-guess/shared'

export type InvalidPushReason = 'invalid_payload' | 'protocol_mismatch'

export interface ProtocolDiagnostic {
  event: ServerPushEventName
  reason: string
  receivedAt: number
}

const diagnostics: ProtocolDiagnostic[] = []
const MAX_DIAGNOSTICS = 20

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

  diagnostics.push({
    event,
    reason:
      reason === 'protocol_mismatch'
        ? 'protocolVersion:mismatch'
        : result.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.') || '<root>'}:${issue.code}`)
            .join(','),
    receivedAt: Date.now(),
  })
  if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift()
  return { ok: false, reason }
}

/** 只暴露副本，避免诊断 UI 或测试修改内部记录。 */
export function getProtocolDiagnostics(): readonly ProtocolDiagnostic[] {
  return diagnostics.map((item) => ({ ...item }))
}

export function clearProtocolDiagnostics(): void {
  diagnostics.length = 0
}
