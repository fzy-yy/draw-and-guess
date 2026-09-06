/**
 * 服务端领域运行时依赖。
 *
 * 时间、定时器和随机数统一从这里注入，使 GameService、RoundMachine、binder 与限频器
 * 可以共享同一套可控运行时；生产环境仍使用系统时钟、Node 定时器和加密随机源。
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto'

export interface Clock {
  now(): number
}

export type TimerHandle = ReturnType<typeof setTimeout>

export interface Scheduler {
  set(delayMs: number, callback: () => void): TimerHandle
  clear(handle: TimerHandle | undefined): void
}

export interface RandomSource {
  uuid(): string
  token(byteLength: number): string
  integer(maxExclusive: number): number
}

export interface RuntimeDependencies {
  clock: Clock
  scheduler: Scheduler
  random: RandomSource
}

export const SYSTEM_RUNTIME: RuntimeDependencies = {
  clock: { now: () => Date.now() },
  scheduler: {
    set: (delayMs, callback) => setTimeout(callback, delayMs),
    clear: (handle) => {
      if (handle) clearTimeout(handle)
    },
  },
  random: {
    uuid: () => randomUUID(),
    token: (byteLength) => randomBytes(byteLength).toString('base64url'),
    integer: (maxExclusive) => randomInt(maxExclusive),
  },
}
