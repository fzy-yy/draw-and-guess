/**
 * 事件限频工具：对高频输入使用一秒滑动窗口拒绝刷包，保护计时与聊天事件。
 */
import { APP_CONFIG } from './config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import { GameError } from './errors.ts'
import type { PlayerSecret } from './models.ts'
import type { Clock } from './runtime.ts'

/** 对猜词/绘图事件执行秒级滑动窗口限频，超限抛 RATE_LIMITED。 */
export function enforceEventRate(player: PlayerSecret, kind: 'guess' | 'draw', clock: Clock): void {
  const now = clock.now()
  const history = (kind === 'guess' ? player.guessEventTimes : player.drawEventTimes).filter(
    (time) => now - time < 1_000,
  )
  const limit =
    kind === 'guess'
      ? APP_CONFIG.network.guessEventsPerSecond
      : APP_CONFIG.drawing.maxDrawEventsPerSecond
  if (history.length >= limit)
    throw new GameError('RATE_LIMITED', serverStrings.errors.RATE_LIMITED)
  history.push(now)
  if (kind === 'guess') player.guessEventTimes = history
  else player.drawEventTimes = history
}
