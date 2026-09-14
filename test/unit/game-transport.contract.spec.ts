import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import { EVENTS } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { createGameTransport } from '../../apps/client/src/application/game-transport.ts'

type TransportSocket = NonNullable<Parameters<typeof createGameTransport>[0]['socket']>

function socketWith(
  emitWithAck: (event: string, payload: Record<string, unknown>) => Promise<unknown>,
) {
  let connected = false
  const disconnect = vi.fn(() => {
    connected = false
    return socket
  })
  const socket = {
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
    timeout: vi.fn(() => socket),
    emitWithAck,
  } as unknown as TransportSocket
  return { socket, disconnect }
}

afterEach(() => vi.useRealTimers())

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
      error: strings.request.timeoutMessage,
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
        : Promise.resolve({ ok: true, data: { done: true }, requestId: payload.requestId })
    })
    const transport = createGameTransport({ socket, notify: vi.fn() })

    const pending = transport.request(
      EVENTS.gameStart,
      { expectedVersion: 1 },
      { requestId: '00000000-0000-4000-8000-000000000099' },
    )
    expect(transport.requestState.pendingCount).toBe(1)
    await vi.advanceTimersByTimeAsync(APP_CONFIG.network.requestTimeoutMs + 1_000)

    await expect(pending).resolves.toEqual({ ok: true, data: { done: true } })
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

    await expect(transport.request(EVENTS.gameResume)).resolves.toMatchObject({
      ok: false,
      failureKind: 'business',
      code: 'INVALID_PHASE',
      error: '当前阶段不能执行此操作',
      timeout: false,
    })
    expect(notify).toHaveBeenCalledWith('当前阶段不能执行此操作', 'error')
  })

  it('quiet 请求默认不重试、不发送失败通知，未知传输错误只暴露统一中文文案', async () => {
    const notify = vi.fn()
    const emitWithAck = vi.fn(() => Promise.reject(new Error('xhr poll error')))
    const { socket } = socketWith(emitWithAck)
    const transport = createGameTransport({ socket, notify })

    await expect(
      transport.request(EVENTS.networkPing, { clientTime: 1 }, { quiet: true }),
    ).resolves.toMatchObject({
      ok: false,
      failureKind: 'transport',
      error: strings.request.genericFailure,
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
        : Promise.resolve({ ok: true, data: { serverTime: 2 }, requestId: payload.requestId })
    })
    const transport = createGameTransport({ socket, notify: vi.fn() })
    const first = transport.request(
      EVENTS.networkPing,
      { clientTime: 1 },
      { quiet: true, retry: false },
    )

    transport.cancelRequests()
    await expect(first).resolves.toMatchObject({ ok: false, cancelled: true })
    resolveAck({ ok: true, data: { serverTime: 1 } })
    await expect(
      transport.request(EVENTS.networkPing, { clientTime: 2 }, { quiet: true }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('destroy 幂等取消在途请求、断开 Socket 并拒绝后续请求', async () => {
    const { socket, disconnect } = socketWith(() => new Promise(() => undefined))
    const transport = createGameTransport({ socket, notify: vi.fn() })
    const pending = transport.request(
      EVENTS.networkPing,
      { clientTime: 1 },
      { quiet: true, retry: false },
    )

    transport.destroy()
    transport.destroy()

    await expect(pending).resolves.toMatchObject({ ok: false, cancelled: true })
    await expect(
      transport.request(EVENTS.networkPing, { clientTime: 2 }, { quiet: true }),
    ).resolves.toMatchObject({ ok: false, cancelled: true })
    expect(transport.requestState).toMatchObject({ pendingCount: 0, destroyed: true })
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
