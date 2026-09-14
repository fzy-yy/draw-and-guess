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
  /** 单通道颜色容差；由主线程从 APP_CONFIG 传入，Worker 自身不依赖配置包。 */
  tolerance: number
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

/**
 * 单并发 Worker 客户端：按需懒创建并常驻复用（避免每次填充重复启动 Worker 线程）；
 * cancel 只废弃结果回写，真正释放线程由组件卸载时的 dispose 负责。
 */
export class FloodFillWorkerClient {
  private worker?: Worker
  private jobId = 0
  private rejectActive?: (reason: Error) => void

  get busy(): boolean {
    return Boolean(this.rejectActive)
  }

  /** 懒创建常驻 Worker；运行环境不支持时返回 undefined，由 fill 走主线程降级。 */
  private ensureWorker(): Worker | undefined {
    if (typeof Worker === 'undefined') return undefined
    this.worker ??= new Worker(new URL('./flood-fill.worker-entry.ts', import.meta.url), {
      type: 'module',
    })
    return this.worker
  }

  async fill(
    image: ImageData,
    input: Omit<FloodFillWorkerRequest, 'type' | 'jobId' | 'width' | 'height' | 'buffer'>,
  ): Promise<FloodFillJobResult> {
    this.cancel()
    const jobId = ++this.jobId
    const worker = this.ensureWorker()
    if (!worker) {
      const metrics = applyFloodFillMeasured(
        image.data,
        image.width,
        image.height,
        input.startX,
        input.startY,
        input.replacement,
        input.tolerance,
      )
      return { image, ...metrics }
    }

    return new Promise<FloodFillJobResult>((resolve, reject) => {
      this.rejectActive = reject
      worker.onmessage = (event: MessageEvent<FloodFillWorkerResponse>) => {
        // 迟到任务（已被 cancel 或被新任务取代）只丢弃结果，不影响当前任务的 pending 状态。
        if (event.data.jobId !== jobId || event.data.roundId !== input.roundId) return
        this.rejectActive = undefined
        resolve({
          image: new ImageData(new Uint8ClampedArray(event.data.buffer), image.width, image.height),
          filledPixels: event.data.filledPixels,
          peakWorkingBytes: event.data.peakWorkingBytes,
        })
      }
      worker.onerror = () => {
        this.rejectActive = undefined
        // 常驻 Worker 不因单次计算异常被销毁：仅拒绝当前任务，后续任务仍可复用该线程。
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
        tolerance: input.tolerance,
        buffer: image.data.buffer as ArrayBuffer,
      }
      worker.postMessage(request, [request.buffer])
    })
  }

  cancel(): void {
    this.jobId += 1
    const reject = this.rejectActive
    this.rejectActive = undefined
    reject?.(new Error('flood-fill job cancelled'))
  }

  /** 组件卸载时释放常驻 Worker（并拒绝在途任务）；下次 fill 会自动重新创建。 */
  dispose(): void {
    this.cancel()
    this.worker?.terminate()
    this.worker = undefined
  }
}
