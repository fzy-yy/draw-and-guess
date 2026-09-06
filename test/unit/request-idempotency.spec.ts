import { afterEach, describe, expect, it, vi } from 'vitest'
import { EVENTS, RequestSchema } from '@draw-guess/shared'
import { createRequester } from '../../apps/client/src/stores/request.ts'
import { bindRequest } from '../../apps/server/src/protocol/binder.ts'
import { GameError } from '../../apps/server/src/errors.ts'

type ClientSocket = Parameters<typeof createRequester>[0]['socket']
type BinderSocket = Parameters<typeof bindRequest>[0]

afterEach(() => vi.useRealTimers())

describe('幂等请求重试', () => {
  it('ack 丢失后自动重试复用同一 requestId，且最终只提示零次错误', async () => {
    vi.useFakeTimers()
    const payloads: Array<Record<string, unknown>> = []
    let attempt = 0
    const fakeSocket = {
      timeout: () => fakeSocket,
      emitWithAck: (_event: string, payload: Record<string, unknown>) => {
        payloads.push(payload)
        attempt += 1
        return attempt === 1
          ? Promise.reject(new Error('operation has timed out'))
          : Promise.resolve({ ok: true, data: { done: true }, requestId: payload.requestId })
      },
    } as unknown as ClientSocket
    const notify = vi.fn()
    const request = createRequester({ socket: fakeSocket, notify })
    const pending = request<{ done: boolean }>(EVENTS.gameStart, { expectedVersion: 1 })
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(pending).resolves.toEqual({ ok: true, data: { done: true } })
    expect(payloads).toHaveLength(2)
    expect(payloads[0]?.requestId).toBe(payloads[1]?.requestId)
    expect(notify).not.toHaveBeenCalled()
  })

  it('服务端成功 ack 在原连接丢失后可由新连接缓存命中，副作用只执行一次', async () => {
    const sharedCache = new Map()
    let handlerCalls = 0
    const createSocket = () => {
      let listener: ((raw: unknown, callback?: (ack: unknown) => void) => Promise<void>) | undefined
      const socket = {
        data: {
          playerId: '00000000-0000-4000-8000-000000000001',
          requestCache: sharedCache,
          inFlightRequests: new Map(),
          service: { clock: { now: () => 1_000 }, logUnexpectedError: () => undefined },
        },
        on: (_event: string, callback: typeof listener) => {
          listener = callback
        },
      } as unknown as BinderSocket
      bindRequest(socket, EVENTS.gameStart, RequestSchema, () => {
        handlerCalls += 1
        return { started: true }
      })
      return () => listener
    }

    const firstListener = createSocket()()
    if (!firstListener) throw new Error('未绑定首个监听器')
    const requestId = '00000000-0000-4000-8000-000000000099'
    await firstListener({ requestId }) // 模拟成功执行后 ack 在网络中丢失

    const secondListener = createSocket()()
    if (!secondListener) throw new Error('未绑定重连监听器')
    let replayed: unknown
    await secondListener({ requestId }, (ack) => (replayed = ack))

    expect(handlerCalls).toBe(1)
    expect(replayed).toMatchObject({ ok: true, data: { started: true }, requestId })
  })

  it('失败 ack 不缓存，同一 requestId 修复瞬时条件后可重新执行', async () => {
    let listener: ((raw: unknown, callback?: (ack: unknown) => void) => Promise<void>) | undefined
    let calls = 0
    const socket = {
      data: {
        playerId: '00000000-0000-4000-8000-000000000001',
        requestCache: new Map(),
        inFlightRequests: new Map(),
        service: { clock: { now: () => 1_000 }, logUnexpectedError: () => undefined },
      },
      on: (_event: string, callback: typeof listener) => (listener = callback),
    } as unknown as BinderSocket
    bindRequest(socket, EVENTS.gameStart, RequestSchema, () => {
      calls += 1
      if (calls === 1) throw new GameError('VERSION_CONFLICT', '版本冲突')
      return { started: true }
    })
    if (!listener) throw new Error('未绑定监听器')
    const request = { requestId: '00000000-0000-4000-8000-000000000098' }
    const acks: unknown[] = []
    await listener(request, (ack) => acks.push(ack))
    await listener(request, (ack) => acks.push(ack))
    expect(acks).toMatchObject([{ ok: false }, { ok: true }])
    expect(calls).toBe(2)
  })
})
