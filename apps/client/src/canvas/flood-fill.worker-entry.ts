/**
 * 洪泛填充 Worker 的独立入口（Vite 将其单独打成一个 chunk，供
 * flood-fill-worker.ts 的 `new Worker(new URL('./flood-fill.worker-entry.ts', …))` 加载）。
 *
 * - bundle 构成刻意最小化：值导入只有纯像素算法 flood-fill.ts（自身仅依赖零 import 的
 *   geometry）；对主线程执行器 flood-fill-worker.ts 只做 **type-only import**——类型在
 *   编译期擦除、不进产物，Worker chunk 因此不携带主线程侧的执行器机制（Worker 构造、
 *   Promise 调度、降级与 dispose），符合 AGENTS「独立 bundle 的轻量导入约束」。
 * - 请求的 buffer 是结构化克隆副本（主线程特意不转移输入，保留原 ImageData 以便失败时
 *   就地降级），所以本线程可对它原地读写；回包时 `response.buffer` 经 transfer 列表做
 *   **所有权一次性交接**：交接后本线程持有的该 ArrayBuffer 立即 detached（长度归 0），
 *   postMessage 之后不得再触碰 data/response.buffer，下一次任务以新副本开始。
 */
import { applyFloodFillMeasured } from './flood-fill'
import type { FloodFillWorkerRequest, FloodFillWorkerResponse } from './flood-fill-worker'

type WorkerScope = {
  onmessage: ((event: MessageEvent<FloodFillWorkerRequest>) => void) | null
  postMessage(message: FloodFillWorkerResponse, transfer: Transferable[]): void
}

const workerScope = globalThis as unknown as WorkerScope
workerScope.onmessage = (event) => {
  const request = event.data
  if (request.type !== 'fill') return
  const data = new Uint8ClampedArray(request.buffer)
  const metrics = applyFloodFillMeasured(
    data,
    request.width,
    request.height,
    request.startX,
    request.startY,
    request.replacement,
    request.tolerance,
  )
  const response: FloodFillWorkerResponse = {
    type: 'filled',
    jobId: request.jobId,
    roundId: request.roundId,
    filledPixels: metrics.filledPixels,
    peakWorkingBytes: metrics.peakWorkingBytes,
    buffer: data.buffer as ArrayBuffer,
  }
  workerScope.postMessage(response, [response.buffer])
}
