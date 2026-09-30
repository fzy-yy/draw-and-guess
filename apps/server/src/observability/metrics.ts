import {
  CLIENT_REQUEST_SCHEMAS,
  ERROR_CODES,
  type ClientRequestEvent,
  type ErrorCode,
} from '@draw-guess/shared'

const MAX_COUNTER = Number.MAX_SAFE_INTEGER
const MAX_LATENCY_MS = 60_000
/**
 * 运行时白名单是有界键空间的执行点（ADR-0007：指标只使用有限协议事件名与错误码）。
 * 类型系统在运行时不生效——调用方经 `as` 绕过类型传入任意键会无界污染 Map 键空间，
 * 因此不能只靠类型约束；测试显式验证「绕过类型的非法值不进入指标」。
 */
const KNOWN_EVENTS = new Set(Object.keys(CLIENT_REQUEST_SCHEMAS))
const KNOWN_ERROR_CODES = new Set<string>(Object.values(ERROR_CODES))

function increment(value: number): number {
  return value >= MAX_COUNTER ? MAX_COUNTER : value + 1
}

export interface OperationalMetricsSnapshot {
  onlineConnections: number
  roomCount: number
  protocol: {
    invalidPushReports: number
    resyncRequests: number
  }
  drawing: {
    budgetRejections: number
  }
  acknowledgements: {
    count: number
    averageLatencyMs: number
  }
  errorsByEvent: Partial<Record<ClientRequestEvent, Partial<Record<ErrorCode, number>>>>
}

/**
 * 进程内有界指标只接受协议枚举与数值，不接收玩家标识、请求载荷或任何展示文本。
 * Map 的键空间由 ClientRequestEvent × ErrorCode 静态封顶，快照始终返回深拷贝。
 */
export class OperationalMetrics {
  private onlineConnections = 0
  private invalidPushReports = 0
  private resyncRequests = 0
  private drawingBudgetRejections = 0
  private acknowledgementCount = 0
  private averageAckLatencyMs = 0
  private readonly errors = new Map<ClientRequestEvent, Map<ErrorCode, number>>()

  connectionOpened(): void {
    this.onlineConnections = increment(this.onlineConnections)
  }

  connectionClosed(): void {
    this.onlineConnections = Math.max(0, this.onlineConnections - 1)
  }

  recordResync(invalidPush: boolean): void {
    this.resyncRequests = increment(this.resyncRequests)
    if (invalidPush) this.invalidPushReports = increment(this.invalidPushReports)
  }

  recordAcknowledgement(event: ClientRequestEvent, latencyMs: number, errorCode?: ErrorCode): void {
    // 运行时白名单判定是有界键空间的执行点（见文件头注释），与类型约束不是双养关系。
    if (!KNOWN_EVENTS.has(event)) return
    const nextCount = increment(this.acknowledgementCount)
    const sample = Number.isFinite(latencyMs) ? Math.min(MAX_LATENCY_MS, Math.max(0, latencyMs)) : 0
    // 递推均值（EWMA 式）：权重随计数递减；计数饱和后权重趋近 0、均值冻结，避免累计值溢出。
    const weight = 1 / Math.max(1, nextCount)
    this.averageAckLatencyMs += (sample - this.averageAckLatencyMs) * weight
    this.acknowledgementCount = nextCount
    if (!errorCode || !KNOWN_ERROR_CODES.has(errorCode)) return

    const eventErrors = this.errors.get(event) ?? new Map<ErrorCode, number>()
    eventErrors.set(errorCode, increment(eventErrors.get(errorCode) ?? 0))
    this.errors.set(event, eventErrors)
    if (errorCode === 'DRAW_BUDGET_EXCEEDED') {
      this.drawingBudgetRejections = increment(this.drawingBudgetRejections)
    }
  }

  snapshot(roomCount: number): OperationalMetricsSnapshot {
    const errorsByEvent: OperationalMetricsSnapshot['errorsByEvent'] = {}
    for (const [event, counts] of this.errors) {
      errorsByEvent[event] = Object.fromEntries(counts)
    }
    return {
      onlineConnections: this.onlineConnections,
      // 调用方唯一（app.ts 传 Map.size）：恒为有限非负整数，无需再钳制/取整/有限性重判。
      roomCount,
      protocol: {
        invalidPushReports: this.invalidPushReports,
        resyncRequests: this.resyncRequests,
      },
      drawing: { budgetRejections: this.drawingBudgetRejections },
      acknowledgements: {
        count: this.acknowledgementCount,
        averageLatencyMs: Math.round(this.averageAckLatencyMs * 100) / 100,
      },
      errorsByEvent,
    }
  }
}
