import { performance } from 'node:perf_hooks'
import { applyFloodFillMeasured, colorToRgba } from '../apps/client/src/canvas/flood-fill.ts'
import { FLOOD_FILL_EXECUTION_MODE } from '../apps/client/src/canvas/flood-fill-worker.ts'
import { drawing } from '../packages/config/src/drawing.ts'

const WIDTH = 1280
const HEIGHT = 720
const RUNS = 30
const WARMUPS = 5
const replacement = colorToRgba('#EF4444')
// 容差仍是公开配置的唯一来源；基准脚本与 Worker 入口一样显式传入，避免 flood-fill 模块依赖配置包。
const TOLERANCE = drawing.fillTolerance

interface BenchmarkCase {
  name: string
  seed: readonly [number, number]
  pixels: Uint8ClampedArray
}

function setPixel(
  pixels: Uint8ClampedArray,
  x: number,
  y: number,
  rgba: readonly [number, number, number, number],
): void {
  const offset = (y * WIDTH + x) * 4
  pixels.set(rgba, offset)
}

function blankCase(): BenchmarkCase {
  return {
    name: '720p 空白',
    seed: [WIDTH / 2, HEIGHT / 2],
    pixels: new Uint8ClampedArray(WIDTH * HEIGHT * 4),
  }
}

function complexCase(): BenchmarkCase {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  const wall = [31, 41, 55, 255] as const
  for (let x = 8; x < WIDTH - 8; x += 1) {
    setPixel(pixels, x, 8, wall)
    setPixel(pixels, x, HEIGHT - 9, wall)
  }
  for (let y = 8; y < HEIGHT - 8; y += 1) {
    setPixel(pixels, 8, y, wall)
    setPixel(pixels, WIDTH - 9, y, wall)
  }
  for (let x = 32; x < WIDTH; x += 32) {
    const gapStart = (x / 32) % 2 === 0 ? 9 : HEIGHT - 33
    for (let y = 9; y < HEIGHT - 9; y += 1) {
      if (y >= gapStart && y < gapStart + 24) continue
      setPixel(pixels, x, y, wall)
    }
  }
  return { name: '720p 复杂封闭区域', seed: [16, HEIGHT / 2], pixels }
}

function antialiasCase(): BenchmarkCase {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  const wall = [31, 41, 55, 255] as const
  const edge = [31, 41, 55, 128] as const
  for (let x = 180; x <= 1100; x += 1) {
    setPixel(pixels, x, 120, wall)
    setPixel(pixels, x, 600, wall)
    setPixel(pixels, x, 121, edge)
    setPixel(pixels, x, 599, edge)
  }
  for (let y = 120; y <= 600; y += 1) {
    setPixel(pixels, 180, y, wall)
    setPixel(pixels, 1100, y, wall)
    setPixel(pixels, 181, y, edge)
    setPixel(pixels, 1099, y, edge)
  }
  return { name: '720p 抗锯齿边界', seed: [WIDTH / 2, HEIGHT / 2], pixels }
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0
}

const results = [blankCase(), complexCase(), antialiasCase()].map((benchmark) => {
  for (let run = 0; run < WARMUPS; run += 1) {
    applyFloodFillMeasured(
      benchmark.pixels.slice(),
      WIDTH,
      HEIGHT,
      benchmark.seed[0],
      benchmark.seed[1],
      replacement,
      TOLERANCE,
    )
  }
  const durations: number[] = []
  let filledPixels = 0
  let peakWorkingBytes = 0
  for (let run = 0; run < RUNS; run += 1) {
    const pixels = benchmark.pixels.slice()
    const startedAt = performance.now()
    const metrics = applyFloodFillMeasured(
      pixels,
      WIDTH,
      HEIGHT,
      benchmark.seed[0],
      benchmark.seed[1],
      replacement,
      TOLERANCE,
    )
    durations.push(performance.now() - startedAt)
    filledPixels = metrics.filledPixels
    peakWorkingBytes = Math.max(peakWorkingBytes, metrics.peakWorkingBytes)
  }
  return {
    case: benchmark.name,
    filledPixels,
    p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
    maxMs: Number(Math.max(...durations).toFixed(2)),
    inputMiB: Number((benchmark.pixels.byteLength / 1024 / 1024).toFixed(2)),
    peakWorkingKiB: Number((peakWorkingBytes / 1024).toFixed(2)),
  }
})

const mainThreadOverBudget = results.some((result) => result.p95Ms > 16)
const executionMode: string = FLOOD_FILL_EXECUTION_MODE
process.stdout.write(
  `${JSON.stringify(
    {
      resolution: `${WIDTH}x${HEIGHT}`,
      runs: RUNS,
      executionMode,
      mainThreadOverBudget,
      results,
    },
    null,
    2,
  )}\n`,
)
if (mainThreadOverBudget && executionMode !== 'worker') process.exitCode = 2
