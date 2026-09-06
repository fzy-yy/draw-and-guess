import type {
  Clock,
  RandomSource,
  RuntimeDependencies,
  Scheduler,
  TimerHandle,
} from '../../../apps/server/src/runtime.ts'

export interface FakeRuntime extends RuntimeDependencies {
  now(): number
  advance(ms: number): number
  jump(ms: number): number
  set(timestamp: number): void
  pendingTimerCount(): number
}

/** 可编程假运行时：推进时间时按到期顺序同步执行全部定时器。 */
export function createFakeRuntime(startAt = 1_700_000_000_000): FakeRuntime {
  let now = startAt
  let timerId = 0
  let randomId = 0
  const timers = new Map<number, { dueAt: number; callback: () => void }>()
  const handles = new WeakMap<object, number>()

  const clock: Clock = { now: () => now }
  const scheduler: Scheduler = {
    set: (delayMs, callback) => {
      const id = ++timerId
      const handle = {} as TimerHandle
      handles.set(handle as object, id)
      timers.set(id, { dueAt: now + Math.max(0, delayMs), callback })
      return handle
    },
    clear: (handle) => {
      if (!handle) return
      const id = handles.get(handle as object)
      if (id !== undefined) timers.delete(id)
    },
  }
  const random: RandomSource = {
    uuid: () => {
      randomId += 1
      return `00000000-0000-4000-8000-${String(randomId).padStart(12, '0')}`
    },
    token: (byteLength) => {
      randomId += 1
      return `${String(randomId).padStart(4, '0')}${'a'.repeat(Math.max(32, byteLength))}`
    },
    integer: (maxExclusive) => {
      if (maxExclusive <= 0) throw new RangeError('maxExclusive must be positive')
      randomId += 1
      return randomId % maxExclusive
    },
  }

  const runUntil = (target: number): void => {
    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0]
      if (!next) break
      const [id, timer] = next
      timers.delete(id)
      now = timer.dueAt
      timer.callback()
    }
    now = target
  }

  return {
    clock,
    scheduler,
    random,
    now: () => now,
    advance: (ms) => {
      runUntil(now + ms)
      return now
    },
    jump: (ms) => {
      now += ms
      return now
    },
    set: (timestamp) => runUntil(timestamp),
    pendingTimerCount: () => timers.size,
  }
}

/** 旧测试名称保留为别名，返回对象现已同时包含 Scheduler 与 RandomSource。 */
export const createFakeClock = createFakeRuntime
export type FakeClock = FakeRuntime
