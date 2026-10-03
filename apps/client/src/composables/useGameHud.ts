/**
 * 对局 HUD 组合式逻辑：时间驱动、剩余时间/进度、猜词权限、阶段标签与排行榜。
 * 从 GameView 拆出，便于独立测试；ticker 的生命周期在 composable 内管理。
 * 计时用 @vueuse/core 的 useTimestamp 驱动（组件卸载自动清理，替代手写 setInterval）。
 */
import { computed } from 'vue'
import { useTimestamp } from '@vueuse/core'
import type { FinalRankingEntry } from '@draw-guess/shared'
import type { useGameStore } from '@/stores/game'
import { phaseTextFor } from '@/utils/phase-text'
import { isOnlineActiveMember } from '@/utils/room-facts'

type GameStore = ReturnType<typeof useGameStore>

/** 最终排行使用服务端冻结的公开结算项。 */
export type RankedMember = FinalRankingEntry

/** 从对局快照派生 HUD 计算属性，并启动/清理时间刷新定时器。 */
export function useGameHud(store: GameStore) {
  // useTimestamp 返回毫秒级响应式时间戳（间隔源自配置）；生命周期说明见文件头。
  const now = useTimestamp({ interval: store.config.ui.tickIntervalMs })

  const game = computed(() => store.room?.game)
  // 校正后的本地时钟：叠加了与服务端的时钟偏移，避免设备时钟偏差导致倒计时不准
  const correctedNow = computed(() => now.value + store.clockOffset)
  // 剩余秒数：按服务端权威截止时间向上取整；暂停状态下固定使用服务端下发的冻结剩余时间，避免随本地时钟持续扣减到 0
  const secondsLeft = computed(() => {
    if (store.room?.phase === 'paused') {
      return Math.max(0, Math.ceil((game.value?.pausedRemainingMs ?? 0) / 1_000))
    }
    return game.value?.phaseEndsAt
      ? Math.max(0, Math.ceil((game.value.phaseEndsAt - correctedNow.value) / 1_000))
      : 0
  })
  // 阶段进度：剩余毫秒 / 阶段总时长，用于进度条 scaleX；暂停状态下固定使用冻结的剩余进度
  const progress = computed(() => {
    if (store.room?.phase === 'paused') {
      const total = (game.value?.phaseEndsAt ?? 0) - (game.value?.phaseStartedAt ?? 0)
      if (total <= 0) return 0
      return Math.max(0, Math.min(1, (game.value?.pausedRemainingMs ?? 0) / total))
    }
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
  // 当前玩家是否可猜词或发言：作画阶段、未猜中（或为当前画家）、非观战且在线
  const canGuess = computed(
    () =>
      store.room?.phase === 'drawing' &&
      (store.isDrawer || !store.me?.guessed) &&
      !store.me?.spectating &&
      !!store.me &&
      isOnlineActiveMember(store.me),
  )
  // 阶段中文标签（画布状态遮罩 / 各面板复用；映射与文案统一来自 utils/phase-text）
  const phaseLabel = computed(() => phaseTextFor(store.room?.phase))
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

  // correctedNow 仅在内部被 secondsLeft/progress 使用，不作为对外返回值暴露（GameView 不消费它）。
  return { game, secondsLeft, progress, canGuess, phaseLabel, rankings }
}
