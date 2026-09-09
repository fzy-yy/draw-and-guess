import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
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

describe('FloodFill Worker job 协议', () => {
  it('新任务取消旧计算并只接受 jobId/roundId 匹配的结果', async () => {
    const client = new FloodFillWorkerClient()
    const first = client
      .fill(image(), { roundId: 'round-a', startX: 1, startY: 1, replacement: [1, 2, 3, 255] })
      .catch((error: unknown) => error)
    const firstWorker = FakeWorker.instances[0]!

    const second = client.fill(image(), {
      roundId: 'round-a',
      startX: 2,
      startY: 2,
      replacement: [4, 5, 6, 255],
    })
    expect(await first).toBeInstanceOf(Error)
    expect(firstWorker.terminated).toBe(true)
    expect(client.busy).toBe(true)

    const secondWorker = FakeWorker.instances[1]!
    expect(secondWorker.request).toMatchObject({ type: 'fill', roundId: 'round-a' })
    secondWorker.complete()
    await expect(second).resolves.toMatchObject({ filledPixels: 4, peakWorkingBytes: 256 })
    expect(client.busy).toBe(false)
  })

  it('回合变更取消活动任务，迟到结果不能重新激活客户端', async () => {
    const client = new FloodFillWorkerClient()
    const pending = client
      .fill(image(), { roundId: 'round-old', startX: 1, startY: 1, replacement: [1, 2, 3, 255] })
      .catch((error: unknown) => error)
    const worker = FakeWorker.instances[0]!

    client.cancel()
    expect(await pending).toBeInstanceOf(Error)
    expect(worker.terminated).toBe(true)
    worker.complete()
    expect(client.busy).toBe(false)
  })
})
