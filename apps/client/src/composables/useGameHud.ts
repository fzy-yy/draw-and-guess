/**
 * 对局 HUD 组合式逻辑：时间驱动、剩余时间/进度、猜词权限、阶段标签、画家与排行榜。
 * 从 GameView 拆出，便于独立测试；ticker 的生命周期在 composable 内管理。
 * 计时用 @vueuse/core 的 useTimestamp 驱动（组件卸载自动清理，替代手写 setInterval）。
 */
import { computed } from 'vue'
import { useTimestamp } from '@vueuse/core'
import { strings } from '@draw-guess/strings'
import type { FinalRankingEntry } from '@draw-guess/shared'
import type { useGameStore } from '@/stores/game'

type GameStore = ReturnType<typeof useGameStore>

/** 最终排行使用服务端冻结的公开结算项。 */
export type RankedMember = FinalRankingEntry

/** 从对局快照派生 HUD 计算属性，并启动/清理时间刷新定时器。 */
export function useGameHud(store: GameStore) {
  // useTimestamp 返回毫秒级响应式时间戳（间隔源自配置），卸载时自动停止，替代手写 ticker。
  const now = useTimestamp({ interval: store.config.ui.tickIntervalMs })

  const game = computed(() => store.room?.game)
  // 校正后的本地时钟：叠加了与服务端的时钟偏移，避免设备时钟偏差导致倒计时不准（F2）
  const correctedNow = computed(() => now.value + store.clockOffset)
  // 剩余秒数：按服务端权威截止时间向上取整
  const secondsLeft = computed(() =>
    game.value?.phaseEndsAt
      ? Math.max(0, Math.ceil((game.value.phaseEndsAt - correctedNow.value) / 1_000))
      : 0,
  )
  // 阶段进度：剩余毫秒 / 阶段总时长，用于进度条 scaleX
  const progress = computed(() => {
    if (!game.value?.phaseEndsAt || game.value.phaseEndsAt <= game.value.phaseStartedAt) return 0
    return Math.max(
      0,
      Math.min(
        1,
        (game.value.phaseEndsAt - correctedNow.value) /
          (game.value.phaseEndsAt - game.value.phaseStartedAt),
      ),
    )
  })
  // 当前玩家是否可猜词：作画阶段、非画家、非观战、未猜中且在线
  const canGuess = computed(
    () =>
      store.room?.phase === 'drawing' &&
      !store.isDrawer &&
      !store.me?.spectating &&
      !store.me?.guessed &&
      store.me?.connection === 'online',
  )
  // 阶段中文标签（画布状态遮罩 / 各面板复用；统一来自 config/strings.ts）
  const phaseLabel = computed(
    () =>
      ({
        starting: strings.status.phaseStarting,
        choosing_word: strings.status.phaseChoosing,
        drawing: strings.status.phaseDrawing,
        round_result: strings.status.phaseRoundResult,
        paused: strings.status.phasePaused,
        game_result: strings.status.phaseGameResult,
        waiting: strings.status.phaseWaiting,
        closed: strings.status.phaseClosed,
      })[store.room?.phase ?? 'waiting'],
  )
  // 当前画家成员信息
  const drawer = computed(() =>
    store.room?.members.find((member) => member.id === game.value?.drawerId),
  )
  // 最终排行：按分数降序并计算同名次（同分并列）
  const rankings = computed<RankedMember[]>(() => {
    // game_result 优先读取服务端在结算瞬间冻结的榜单；旧快照缺少该字段时才回退实时成员。
    if (store.room?.phase === 'game_result' && game.value?.finalRanking)
      return game.value.finalRanking
    const members = [...(store.room?.members ?? [])]
      .filter((member) => !member.spectating)
      .sort((a, b) => b.score - a.score)
    let previous = -1
    let rank = 0
    return members.map((member, index) => {
      if (member.score !== previous) rank = index + 1
      previous = member.score
      return {
        id: member.id,
        nickname: member.nickname,
        avatarId: member.avatarId,
        rank,
        score: member.score,
        stats: member.stats,
      }
    })
  })

  // 无需手动清理：useTimestamp 组件卸载自动停止计时器，避免残留 setInterval。

  // correctedNow 仅在内部被 secondsLeft/progress 使用，不作为对外返回值暴露（GameView 不消费它）。
  return { game, secondsLeft, progress, canGuess, phaseLabel, drawer, rankings }
}
