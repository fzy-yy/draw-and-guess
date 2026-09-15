import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import {
  FloodFillError,
  FloodFillWorkerClient,
  type FloodFillWorkerRequest,
  type FloodFillWorkerResponse,
} from '../../apps/client/src/canvas/flood-fill-worker.ts'

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<FloodFillWorkerResponse>) => void) | null = null
  onerror: (() => void) | null = null
  request?: FloodFillWorkerRequest
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(request: FloodFillWorkerRequest): void {
    this.request = request
  }

  terminate(): void {
    this.terminated = true
  }

  complete(): void {
    const request = this.request!
    this.onmessage?.({
      data: {
        type: 'filled',
        jobId: request.jobId,
        roundId: request.roundId,
        filledPixels: 4,
        peakWorkingBytes: 256,
        buffer: request.buffer,
      },
    } as MessageEvent<FloodFillWorkerResponse>)
  }

  /** 模拟 Worker 运行失败：脚本加载失败或计算抛错都会走 onerror。 */
  fail(): void {
    this.onerror?.()
  }
}

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('ImageData', FakeImageData)
})

afterEach(() => vi.unstubAllGlobals())

function image(): ImageData {
  return new FakeImageData(new Uint8ClampedArray(4 * 4 * 4), 4, 4) as unknown as ImageData
}

function request(roundId = 'round-a') {
  return {
    roundId,
    startX: 1,
    startY: 1,
    replacement: [1, 2, 3, 255] as const,
    tolerance: APP_CONFIG.drawing.fillTolerance,
  }
}

describe('FloodFill Worker job 协议', () => {
  it('新任务取消旧计算并只接受 jobId/roundId 匹配的结果，且复用同一个常驻 Worker', async () => {
    const client = new FloodFillWorkerClient()
    const first = client.fill(image(), request()).catch((error: unknown) => error)
    const worker = FakeWorker.instances[0]!

    const second = client.fill(image(), { ...request(), startX: 2, startY: 2 })
    expect(await first).toBeInstanceOf(Error)
    expect(worker.terminated).toBe(false)
    expect(FakeWorker.instances).toHaveLength(1)
    expect(client.busy).toBe(true)

    expect(worker.request).toMatchObject({ type: 'fill', roundId: 'round-a' })
    worker.complete()
    await expect(second).resolves.toMatchObject({
      filledPixels: 4,
      peakWorkingBytes: 256,
      execution: 'worker',
      degraded: false,
    })
    expect(client.busy).toBe(false)
  })

  it('回合变更取消活动任务，迟到结果不能重新激活客户端', async () => {
    const client = new FloodFillWorkerClient()
    const pending = client.fill(image(), request('round-old')).catch((error: unknown) => error)
    const worker = FakeWorker.instances[0]!

    client.cancel()
    expect(await pending).toBeInstanceOf(Error)
    expect(worker.terminated).toBe(false)
    worker.complete()
    expect(client.busy).toBe(false)
  })

  it('dispose 终止常驻 Worker 并拒绝在途任务，后续 fill 会重新创建', async () => {
    const client = new FloodFillWorkerClient()
    const pending = client.fill(image(), request()).catch((error: unknown) => error)
    const worker = FakeWorker.instances[0]!

    client.dispose()
    expect(await pending).toBeInstanceOf(Error)
    expect(worker.terminated).toBe(true)
    expect(client.busy).toBe(false)

    void client.fill(image(), request('round-b'))
    expect(FakeWorker.instances).toHaveLength(2)
  })
})

describe('FloodFill Worker 失败降级', () => {
  it('Worker 运行失败时终止旧线程，并在同一 ImageData 上只做一次主线程降级', async () => {
    const client = new FloodFillWorkerClient()
    const source = image()
    const pending = client.fill(source, request())
    const worker = FakeWorker.instances[0]!

    worker.fail()

    const result = await pending
    expect(worker.terminated).toBe(true)
    expect(result.execution).toBe('main_thread')
    expect(result.degraded).toBe(true)
    // 降级必须复用同一个 ImageData，且结果就地写回该缓冲。
    expect(result.image).toBe(source)
    expect(result.filledPixels).toBe(16)
    expect([...source.data.slice(0, 4)]).toEqual([1, 2, 3, 255])
    expect(client.busy).toBe(false)

    // 坏线程已被释放：下一次填充重新创建 Worker，而不是继续复用或反复降级。
    void client.fill(image(), request('round-b'))
    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[1]!.terminated).toBe(false)
  })

  it('主线程降级同样失败时以 unavailable 拒绝，调用方据此请求权威全量快照', async () => {
    const client = new FloodFillWorkerClient()
    // 缓冲区不可用（例如被转移后作废）：主线程无法基于同一 ImageData 完成降级。
    const detached = new FakeImageData(new Uint8ClampedArray(0), 4, 4) as unknown as ImageData
    const pending = client.fill(detached, request())
    FakeWorker.instances[0]!.fail()

    const error = await pending.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(FloodFillError)
    expect((error as FloodFillError).reason).toBe('unavailable')
    expect(FakeWorker.instances[0]!.terminated).toBe(true)
    expect(client.busy).toBe(false)
  })

  it('取消不算失败：不终止仍可复用的 Worker，也不触发主线程降级', async () => {
    const client = new FloodFillWorkerClient()
    const source = image()
    const pending = client.fill(source, request())
    const worker = FakeWorker.instances[0]!

    client.cancel()

    const error = await pending.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(FloodFillError)
    expect((error as FloodFillError).reason).toBe('cancelled')
    expect(worker.terminated).toBe(false)
    expect([...source.data.slice(0, 4)]).toEqual([0, 0, 0, 0])
  })
})
