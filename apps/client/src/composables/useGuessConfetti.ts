/**
 * 猜中礼花反馈：监听本机玩家的「已猜中」状态跃迁，触发一次全屏礼花。
 *
 * 触发条件是**严格跃迁**（上一值为 false → 当前值为 true），且**不枚举阶段**：
 * - 为什么不用阶段枚举：最后一名猜词者猜中时，服务端会在同一份快照里把阶段推进到
 *   round_result；若是最后一回合，稍后还会进入 game_result。只认 drawing 会漏掉
 *   「最后一人猜中」这一最该庆祝的时刻（曾出现的缺陷）。
 * - 为什么要求 prev === false 而非 !prev：后者把「本组件挂载时的 undefined」也当成 false，
 *   页面重载/重连后若快照里已经是「已猜中」，会被误判成一次新猜中而补放礼花。
 *
 * 依赖收窄为 `me` 与 `settings` 两个成员，便于测试注入最小替身。
 */
import { watch } from 'vue'
import type { useGameStore } from '@/stores/game'
import { fireGuessCorrectConfetti } from '@/utils/confetti'

type GuessConfettiStore = Pick<ReturnType<typeof useGameStore>, 'me' | 'settings'>

export function useGuessConfetti(store: GuessConfettiStore): void {
  watch(
    () => store.me?.guessed,
    (guessed, prev) => {
      if (guessed !== true || prev !== false) return
      // 礼花发射器首次触发时创建并缓存（见 utils/confetti.ts）
      if (store.settings.animationsEnabled) void fireGuessCorrectConfetti()
    },
  )
}
