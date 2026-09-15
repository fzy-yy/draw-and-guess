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

/** 本次填充实际使用的执行路径：worker 为线程计算，main_thread 为环境不支持或降级后计算。 */
export type FloodFillExecutionMode = 'worker' | 'main_thread'

export interface FloodFillJobResult {
  image: ImageData
  filledPixels: number
  peakWorkingBytes: number
  execution: FloodFillExecutionMode
  /** Worker 失败后由主线程对同一 ImageData 降级完成：结果正确，但线程已终止重建。 */
  degraded: boolean
}

export type FloodFillFailureReason =
  /** 任务被取消或被新任务取代：结果作废，不是故障。 */
  | 'cancelled'
  /** Worker 与主线程降级都无法完成：调用方需请求权威全量快照。 */
  | 'unavailable'

export class FloodFillError extends Error {
  constructor(readonly reason: FloodFillFailureReason) {
    super(`flood-fill ${reason}`)
  }
}

/**
 * 单并发填充执行器：优先交给常驻 Worker 计算，失败时终止该线程并在主线程降级一次
 * （判定与取舍见 docs/adr/0009-fill-degradation-and-locks.md）。
 *
 * 取消只废弃结果回写（迟到的 jobId/roundId 不匹配即丢弃），真正释放线程由 dispose 负责；
 * 只有 Worker 运行失败才会终止线程，避免后续每次填充都复用一个已损坏的线程。
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
    const worker = this.ensureWorker()
    const jobId = ++this.jobId
    if (!worker) return this.runOnMainThread(image, input, false)

    try {
      const result = await this.runInWorker(worker, jobId, image, input)
      return { ...result, execution: 'worker', degraded: false }
    } catch (error) {
      // 被取消或被新任务取代：结果已作废，不能按「失败」降级（否则会用过期历史算出一块错误区域）。
      if (jobId !== this.jobId) throw error
      // Worker 线程可能已损坏（脚本加载失败或计算异常）：终止重建，而不是持续复用坏线程。
      this.terminateWorker()
      return this.runOnMainThread(image, input, true)
    }
  }

  private runInWorker(
    worker: Worker,
    jobId: number,
    image: ImageData,
    input: Omit<FloodFillWorkerRequest, 'type' | 'jobId' | 'width' | 'height' | 'buffer'>,
  ): Promise<Omit<FloodFillJobResult, 'execution' | 'degraded'>> {
    return new Promise((resolve, reject) => {
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
        reject(new FloodFillError('unavailable'))
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
      // 不转移输入缓冲：只复制一份给 Worker，主线程仍持有同一 ImageData，
      // 才能在 Worker 失败后就地降级而不必重读画布（代价是每次填充一次结构化克隆）。
      worker.postMessage(request)
    })
  }

  /**
   * 主线程降级：对同一 ImageData 就地计算并写回。
   * 缓冲已失效（宽度/高度与像素长度不一致）或计算抛错时按不可用处理，交由调用方请求权威快照。
   */
  private runOnMainThread(
    image: ImageData,
    input: Omit<FloodFillWorkerRequest, 'type' | 'jobId' | 'width' | 'height' | 'buffer'>,
    degraded: boolean,
  ): FloodFillJobResult {
    if (image.data.length !== image.width * image.height * 4)
      throw new FloodFillError('unavailable')
    const metrics = applyFloodFillMeasured(
      image.data,
      image.width,
      image.height,
      input.startX,
      input.startY,
      input.replacement,
      input.tolerance,
    )
    return { image, ...metrics, execution: 'main_thread', degraded }
  }

  cancel(): void {
    this.jobId += 1
    const reject = this.rejectActive
    this.rejectActive = undefined
    reject?.(new FloodFillError('cancelled'))
  }

  private terminateWorker(): void {
    const worker = this.worker
    this.worker = undefined
    worker?.terminate()
  }

  /** 组件卸载时释放常驻 Worker（并拒绝在途任务）；下次 fill 会自动重新创建。 */
  dispose(): void {
    this.cancel()
    this.terminateWorker()
  }
}
