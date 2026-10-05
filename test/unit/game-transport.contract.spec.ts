import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import { EVENTS } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { createGameTransport } from '../../apps/client/src/application/game-transport.ts'
import {
  clearResponseDiagnostics,
  getResponseDiagnostics,
} from '../../apps/client/src/stores/response-protocol.ts'

type TransportSocket = NonNullable<Parameters<typeof createGameTransport>[0]['socket']>

function socketWith(
  emitWithAck: (event: string, payload: Record<string, unknown>) => Promise<unknown>,
) {
  let connected = false
  const disconnect = vi.fn(() => {
    connected = false
    return socket
  })
  const socket: TransportSocket = {
    get connected() {
      return connected
    },
    io: { on: vi.fn(), off: vi.fn() },
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(() => {
      connected = true
      return socket
    }),
    disconnect,
    emitWithAck,
  }
  return { socket, disconnect }
}

afterEach(() => {
  vi.useRealTimers()
  clearResponseDiagnostics()
})

describe('GameTransport 请求契约', () => {
  it('超时由自有哨兵判定：返回 transport 失败，只通知一次并恢复可观测 pending 状态', async () => {
    vi.useFakeTimers()
    const notify = vi.fn()
    const { socket } = socketWith(() => new Promise(() => undefined))
    const transport = createGameTransport({ socket, notify })

    const pending = transport.request(EVENTS.networkPing, { clientTime: 1 }, { retry: false })
    expect(transport.requestState.pendingCount).toBe(1)
    await vi.advanceTimersByTimeAsync(APP_CONFIG.network.requestTimeoutMs)

    await expect(pending).resolves.toMatchObject({
      ok: false,
      failureKind: 'transport',
      error: strings.ui.request.timeoutMessage,
      timeout: true,
    })
    expect(notify).toHaveBeenCalledOnce()
    expect(transport.requestState.pendingCount).toBe(0)
  })

  it('传输重试复用同一 requestId 并只提交一个逻辑请求状态', async () => {
    vi.useFakeTimers()
    const payloads: Record<string, unknown>[] = []
    let attempts = 0
    const { socket } = socketWith((_event, payload) => {
      payloads.push(payload)
      attempts += 1
      return attempts === 1
        ? new Promise(() => undefined)
        : Promise.resolve({ ok: true, data: { success: true }, requestId: payload.requestId })
    })
    const transport = createGameTransport({ socket, notify: vi.fn() })

    const pending = transport.request(
      EVENTS.sessionLogout,
      {},
      { requestId: '00000000-0000-4000-8000-000000000099' },
    )
    expect(transport.requestState.pendingCount).toBe(1)
    await vi.advanceTimersByTimeAsync(APP_CONFIG.network.requestTimeoutMs + 1_000)

    await expect(pending).resolves.toEqual({ ok: true, data: { success: true } })
    expect(payloads.map(({ requestId }) => requestId)).toEqual([
      '00000000-0000-4000-8000-000000000099',
      '00000000-0000-4000-8000-000000000099',
    ])
    expect(transport.requestState.pendingCount).toBe(0)
  })

  it('业务错误保留登记错误码和安全文案并通知调用方', async () => {
    const notify = vi.fn()
    const { socket } = socketWith((_event, payload) =>
      Promise.resolve({
        ok: false,
        requestId: payload.requestId,
        error: { code: 'INVALID_PHASE', message: '当前阶段不能执行此操作' },
      }),
    )
    const transport = createGameTransport({ socket, notify })

    await expect(transport.request(EVENTS.gameEndEarly)).resolves.toMatchObject({
      ok: false,
      failureKind: 'business',
      code: 'INVALID_PHASE',
      error: '当前阶段不能执行此操作',
      timeout: false,
    })
    expect(notify).toHaveBeenCalledWith('当前阶段不能执行此操作', 'error')
  })

  it('静默且不重试的请求只发送失败通知零次，未知传输错误只暴露统一中文文案', async () => {
    const notify = vi.fn()
    const emitWithAck = vi.fn(() => Promise.reject(new Error('xhr poll error')))
    const { socket } = socketWith(emitWithAck)
    const transport = createGameTransport({ socket, notify })

    await expect(
      transport.request(EVENTS.networkPing, { clientTime: 1 }, { retry: false, notify: 'silent' }),
    ).resolves.toMatchObject({
      ok: false,
      failureKind: 'transport',
      error: strings.ui.request.genericFailure,
      timeout: false,
    })
    expect(emitWithAck).toHaveBeenCalledOnce()
    expect(notify).not.toHaveBeenCalled()
  })

  it('cancelRequests 取消当前请求但允许后续请求', async () => {
    let resolveAck!: (value: unknown) => void
    const firstAck = new Promise((resolve) => (resolveAck = resolve))
    let calls = 0
    const { socket } = socketWith((_event, payload) => {
      calls += 1
      return calls === 1
        ? firstAck
        : Promise.resolve({
            ok: true,
            data: { clientTime: payload.clientTime, serverTime: 2 },
            requestId: payload.requestId,
          })
    })
    const transport = createGameTransport({ socket, notify: vi.fn() })
    const first = transport.request(
      EVENTS.networkPing,
      { clientTime: 1 },
      { retry: false, notify: 'silent' },
    )

    transport.cancelRequests()
    await expect(first).resolves.toMatchObject({ ok: false, cancelled: true })
    resolveAck({ ok: true, data: { clientTime: 1, serverTime: 1 }, requestId: 'cancelled' })
    await expect(
      transport.request(EVENTS.networkPing, { clientTime: 2 }, { retry: false, notify: 'silent' }),
    ).resolves.toMatchObject({ ok: true, data: { clientTime: 2, serverTime: 2 } })
  })

  it('destroy 幂等取消在途请求、断开 Socket 并拒绝后续请求', async () => {
    const { socket, disconnect } = socketWith(() => new Promise(() => undefined))
    const transport = createGameTransport({ socket, notify: vi.fn() })
    const pending = transport.request(
      EVENTS.networkPing,
      { clientTime: 1 },
      { retry: false, notify: 'silent' },
    )

    transport.destroy()
    transport.destroy()

    await expect(pending).resolves.toMatchObject({ ok: false, cancelled: true })
    await expect(
      transport.request(EVENTS.networkPing, { clientTime: 2 }, { retry: false, notify: 'silent' }),
    ).resolves.toMatchObject({ ok: false, cancelled: true })
    expect(transport.requestState).toMatchObject({ pendingCount: 0, destroyed: true })
    expect(disconnect).toHaveBeenCalledOnce()
  })
})

describe('请求响应运行时 Schema 边界', () => {
  it('malformed success 不重试：返回 protocol 失败、统一安全文案并记录脱敏诊断', async () => {
    const notify = vi.fn()
    // game:start 的成功响应必须携带 RoomSnapshot；缺失 data 的成功外壳属于损坏响应。
    const emitWithAck = vi.fn((_event: string, payload: Record<string, unknown>) =>
      Promise.resolve({ ok: true, requestId: payload.requestId }),
    )
    const { socket } = socketWith(emitWithAck)
    const transport = createGameTransport({ socket, notify })

    await expect(
      transport.request(EVENTS.gameStart, { expectedVersion: 1 }),
    ).resolves.toMatchObject({
      ok: false,
      failureKind: 'protocol',
      error: strings.ui.request.protocolFailure,
      timeout: false,
    })
    // 协议损坏是确定性结果：默认重试开启也不得重复发送。
    expect(emitWithAck).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith(strings.ui.request.protocolFailure, 'error')
    const diagnostic = getResponseDiagnostics().at(-1)
    expect(diagnostic).toMatchObject({ event: EVENTS.gameStart })
    expect(diagnostic?.reason).toContain('data')
    expect(Object.keys(diagnostic!).sort()).toEqual(['event', 'reason', 'receivedAt'])
  })

  it('未知错误码与 requestId 不匹配按协议损坏处理，诊断不包含响应正文', async () => {
    const notify = vi.fn()
    let calls = 0
    const { socket } = socketWith((_event, payload) => {
      calls += 1
      return Promise.resolve(
        calls === 1
          ? {
              ok: false,
              requestId: payload.requestId,
              error: { code: 'NOT_REGISTERED', message: '未登记的错误码' },
            }
          : {
              ok: false,
              requestId: '00000000-0000-4000-8000-000000000001',
              error: { code: 'RATE_LIMITED', message: '请求过于频繁' },
            },
      )
    })
    const transport = createGameTransport({ socket, notify })

    await expect(transport.request(EVENTS.gameEndEarly)).resolves.toMatchObject({
      ok: false,
      failureKind: 'protocol',
    })
    await expect(transport.request(EVENTS.gameEndEarly)).resolves.toMatchObject({
      ok: false,
      failureKind: 'protocol',
    })

    const diagnostics = getResponseDiagnostics()
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]?.event).toBe(EVENTS.gameEndEarly)
    expect(diagnostics[0]?.reason).toContain('error.code')
    expect(diagnostics[1]?.reason).toBe('requestId:mismatch')
    expect(notify).toHaveBeenCalledTimes(2)
    // 诊断与通知都不得回显响应内容：未知错误码、错误文案、requestId 值都不允许出现。
    expect(JSON.stringify(diagnostics)).not.toContain('NOT_REGISTERED')
    expect(JSON.stringify(diagnostics)).not.toContain('未登记的错误码')
    expect(JSON.stringify(diagnostics)).not.toContain('00000000-0000-4000-8000-000000000001')
    for (const item of diagnostics) {
      expect(Object.keys(item).sort()).toEqual(['event', 'reason', 'receivedAt'])
    }
  })

  it('无返回数据的事件允许 data 缺省或显式 undefined，且静默请求协议失败不通知', async () => {
    const { socket } = socketWith((_event, payload) =>
      Promise.resolve({ ok: true, requestId: payload.requestId }),
    )
    const transport = createGameTransport({ socket, notify: vi.fn() })
    await expect(transport.request(EVENTS.gameEndEarly)).resolves.toEqual({
      ok: true,
      data: undefined,
    })

    const undefinedData = socketWith((_event, payload) =>
      Promise.resolve({ ok: true, data: undefined, requestId: payload.requestId }),
    )
    const second = createGameTransport({ socket: undefinedData.socket, notify: vi.fn() })
    await expect(second.request(EVENTS.gameLeave)).resolves.toEqual({
      ok: true,
      data: undefined,
    })

    const notify = vi.fn()
    const malformed = socketWith(() => Promise.resolve(undefined))
    const third = createGameTransport({ socket: malformed.socket, notify })
    await expect(
      third.request(EVENTS.networkPing, { clientTime: 1 }, { retry: false, notify: 'silent' }),
    ).resolves.toMatchObject({ ok: false, failureKind: 'protocol' })
    expect(notify).not.toHaveBeenCalled()
  })
})
