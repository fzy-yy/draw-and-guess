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
