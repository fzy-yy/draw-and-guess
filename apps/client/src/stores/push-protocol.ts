/** 服务端主动推送的统一运行时解码与脱敏诊断记录。 */
import { SERVER_PUSH_SCHEMAS, type ServerPushEventName } from '@draw-guess/shared'

export interface ProtocolDiagnostic {
  event: ServerPushEventName
  reason: string
  receivedAt: number
}

const diagnostics: ProtocolDiagnostic[] = []
const MAX_DIAGNOSTICS = 20

export function decodeServerPush(
  event: ServerPushEventName,
  raw: unknown,
): { ok: true; data: unknown } | { ok: false } {
  const result = SERVER_PUSH_SCHEMAS[event].safeParse(raw)
  if (result.success) return { ok: true, data: result.data.data }

  diagnostics.push({
    event,
    reason: result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '<root>'}:${issue.code}`)
      .join(','),
    receivedAt: Date.now(),
  })
  if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift()
  return { ok: false }
}

/** 只暴露副本，避免诊断 UI 或测试修改内部记录。 */
export function getProtocolDiagnostics(): readonly ProtocolDiagnostic[] {
  return diagnostics.map((item) => ({ ...item }))
}

export function clearProtocolDiagnostics(): void {
  diagnostics.length = 0
}
