import { applyFloodFillMeasured, type Rgba } from './flood-fill'

export const FLOOD_FILL_EXECUTION_MODE = 'worker' as const

export interface FloodFillWorkerRequest {
  type: 'fill'
  jobId: number
  roundId: string
  width: number
  height: number
  startX: number
  startY: number
  replacement: Rgba
  buffer: ArrayBuffer
}

export interface FloodFillWorkerResponse {
  type: 'filled'
  jobId: number
  roundId: string
  filledPixels: number
  peakWorkingBytes: number
  buffer: ArrayBuffer
}

export interface FloodFillJobResult {
  image: ImageData
  filledPixels: number
  peakWorkingBytes: number
}

/** 单并发 Worker 客户端：新任务或回合切换会终止旧 Worker，使迟到结果无法写回逻辑画布。 */
export class FloodFillWorkerClient {
  private worker?: Worker
  private jobId = 0
  private rejectActive?: (reason: Error) => void

  get busy(): boolean {
    return Boolean(this.rejectActive)
  }

  async fill(
    image: ImageData,
    input: Omit<FloodFillWorkerRequest, 'type' | 'jobId' | 'width' | 'height' | 'buffer'>,
  ): Promise<FloodFillJobResult> {
    this.cancel()
    const jobId = ++this.jobId
    if (typeof Worker === 'undefined') {
      const metrics = applyFloodFillMeasured(
        image.data,
        image.width,
        image.height,
        input.startX,
        input.startY,
        input.replacement,
      )
      return { image, ...metrics }
    }

    const worker = new Worker(new URL('./flood-fill.worker-entry.ts', import.meta.url), {
      type: 'module',
    })
    this.worker = worker
    return new Promise<FloodFillJobResult>((resolve, reject) => {
      this.rejectActive = reject
      worker.onmessage = (event: MessageEvent<FloodFillWorkerResponse>) => {
        if (event.data.jobId !== jobId || event.data.roundId !== input.roundId) return
        this.rejectActive = undefined
        worker.terminate()
        if (this.worker === worker) this.worker = undefined
        resolve({
          image: new ImageData(new Uint8ClampedArray(event.data.buffer), image.width, image.height),
          filledPixels: event.data.filledPixels,
          peakWorkingBytes: event.data.peakWorkingBytes,
        })
      }
      worker.onerror = () => {
        this.rejectActive = undefined
        worker.terminate()
        if (this.worker === worker) this.worker = undefined
        reject(new Error('flood-fill worker failed'))
      }
      const request: FloodFillWorkerRequest = {
        type: 'fill',
        jobId,
        roundId: input.roundId,
        width: image.width,
        height: image.height,
        startX: input.startX,
        startY: input.startY,
        replacement: input.replacement,
        buffer: image.data.buffer as ArrayBuffer,
      }
      worker.postMessage(request, [request.buffer])
    })
  }

  cancel(): void {
    this.jobId += 1
    this.worker?.terminate()
    this.worker = undefined
    const reject = this.rejectActive
    this.rejectActive = undefined
    reject?.(new Error('flood-fill job cancelled'))
  }
}
