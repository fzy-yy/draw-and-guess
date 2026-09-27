/**
 * 事件限频工具：滑动窗口判定单一口径 + 高频输入的事件级裁决。
 * 请求级（binder）与短码加入（membership）共用同一 slidingWindowAllow 形状，
 * 窗口与阈值由调用方显式传入（配置归属见各调用点）。
 */
import { APP_CONFIG } from './config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import { GameError } from './errors.ts'
import type { PlayerSecret } from './models.ts'
import type { Clock } from './runtime.ts'

export interface SlidingWindowDecision {
  allowed: boolean
  /** 已丢弃过期项的队列；放行时含本次时间戳，拒绝时不含。调用点决定回写策略（binder/短码拒绝也回写以滚窗口；事件限频保留原队列）。 */
  times: number[]
}

/**
 * 滑动窗口限频纯函数：先丢窗口外旧记录，再判是否达到上限；
 * 放行时把 now 登记进队列。拒绝时同样返回过滤后的队列（下次调用从更新的窗口起算）。
 */
export function slidingWindowAllow(
  times: readonly number[],
  now: number,
  windowMs: number,
  limit: number,
): SlidingWindowDecision {
  const recent = times.filter((time) => now - time < windowMs)
  if (recent.length >= limit) return { allowed: false, times: recent }
  recent.push(now)
  return { allowed: true, times: recent }
}

/** 对猜词/绘图事件执行事件级滑动窗口限频，超限抛 RATE_LIMITED。 */
export function enforceEventRate(player: PlayerSecret, kind: 'guess' | 'draw', clock: Clock): void {
  const limit =
    kind === 'guess'
      ? APP_CONFIG.network.guessEventsPerSecond
      : APP_CONFIG.drawing.maxDrawEventsPerSecond
  const previous = kind === 'guess' ? player.guessEventTimes : player.drawEventTimes
  const decision = slidingWindowAllow(
    previous,
    clock.now(),
    APP_CONFIG.network.eventRateWindowMs,
    limit,
  )
  if (!decision.allowed) throw new GameError('RATE_LIMITED', serverStrings.errors.RATE_LIMITED)
  if (kind === 'guess') player.guessEventTimes = decision.times
  else player.drawEventTimes = decision.times
}
