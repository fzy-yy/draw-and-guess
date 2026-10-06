/**
 * 服务端统一运行时依赖契约与生产适配层。
 *
 * 遵循架构约定：
 * 领域服务与状态机禁止直接调用全局 Date.now()、setTimeout、Math.random 等非受控方法，
 * 统一通过 Clock、Scheduler、RandomSource 窄接口注入，保证单元测试可精确通过 fake-clock 同步推进。
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto'

/**
 * 统一时间时钟接口。
 */
export interface Clock {
  /** 获取当前单调时间戳（毫秒） */
  now(): number
}

/** 定时器句柄类型：显式命名类型，不使用 ReturnType 反推 */
export type TimerHandle = NodeJS.Timeout

/**
 * 统一任务调度器接口。
 */
export interface Scheduler {
  /** 调度延时任务 */
  set(delayMs: number, callback: () => void): TimerHandle
  /** 清理已调度的延时任务 */
  clear(handle: TimerHandle | undefined): void
}

/**
 * 统一随机数发生器接口。
 */
export interface RandomSource {
  /** 生成标准 UUID */
  uuid(): string
  /** 生成安全随机 Token（base64url） */
  token(byteLength: number): string
  /** 生成 [0, maxExclusive) 区间内的随机整数 */
  integer(maxExclusive: number): number
}

/**
 * 运行时依赖组合包。
 */
export interface RuntimeDependencies {
  clock: Clock
  scheduler: Scheduler
  random: RandomSource
}

/**
 * 生产环境系统级默认运行时实现（唯一允许绑定真实底层 Node/Crypto/Timer 的适配层）。
 */
export const SYSTEM_RUNTIME: RuntimeDependencies = {
  clock: {
    now: () => Date.now(),
  },
  scheduler: {
    set: (delayMs, callback) => setTimeout(callback, delayMs),
    clear: (handle) => {
      clearTimeout(handle)
    },
  },
  random: {
    uuid: () => randomUUID(),
    token: (byteLength) => randomBytes(byteLength).toString('base64url'),
    integer: (maxExclusive) => randomInt(maxExclusive),
  },
}
