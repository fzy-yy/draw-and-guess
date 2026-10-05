/**
 * 对局 HUD 组合式逻辑：时间驱动、剩余时间/进度、猜词权限、阶段标签、排行榜与接龙派生。
 * 从 GameView 拆出，便于独立测试；ticker 的生命周期在 composable 内管理。
 * 计时用 @vueuse/core 的 useTimestamp 驱动（组件卸载自动清理，替代手写 setInterval）。
 *
 * 接龙派生（S73 / S74 / S84）：题面、棒次、上一家 chip、提交/投票状态与复盘链进度都收在这里，
 * 舞台与顶栏组件只消费派生结果（模式分流集中在 HUD 层，组件保持按 props 渲染）。
 */
import { computed, ref, watch } from 'vue'
import { useTimestamp } from '@vueuse/core'
import { strings } from '@draw-guess/strings'
import type { FinalRankingEntry, RelayPlayerRef } from '@draw-guess/shared'
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
  /** 接龙视图：接龙房（含终局）恒有；经典房恒为 undefined。 */
  const relay = computed(() => store.room?.relay)
  // 校正后的本地时钟：叠加了与服务端的时钟偏移，避免设备时钟偏差导致倒计时不准
  const correctedNow = computed(() => now.value + store.clockOffset)
  /**
   * 接龙开局倒计时的**展示用**本地窗口（起止毫秒）：接龙房在 `starting` 期还没有接龙视图
   * （服务端的接龙阶段白名单，S22），因此拿不到权威的 `phaseEndsAt`；若任由它缺省为 0，
   * 顶栏会读成「不限时」、开局遮罩的大数字会停在 0。
   *
   * 它只喂给**数字与进度条**：阶段推进、遮罩显隐、任何逻辑分支都不依赖本窗口，
   * 一切门禁仍由服务端快照驱动（窗口走完而快照未换阶段时，数字停在 0，界面不动）。
   * 时长取与服务端 `beginStarting` 同源的公开配置（同一个字段，不写死数字）；
   * 锚点＝首次观察到进入 `starting` 时的**校正时钟**读数（与倒计时的读数同源，避免刻度误差
   * 让 3 秒读成 4 秒）；离开该阶段或断线即清空，重连后按新锚点重算，同一次 starting 内不漂移。
   */
  const relayStartingWindow = ref<{ startedAt: number; endsAt: number }>()
  watch(
    [() => store.room?.phase, () => store.room?.gameMode, () => store.connected],
    ([phase, gameMode, connected]) => {
      // 断线期间不留锚点：连接恢复后重新起算（本地窗口只服务这一小段观感）
      if (phase !== 'starting' || gameMode !== 'relay' || !connected) {
        relayStartingWindow.value = undefined
        return
      }
      // 同一次 starting 内只立一次锚点：同一阶段的后续快照重发不把倒计时拉回起点。
      if (relayStartingWindow.value) return
      const anchorMs = correctedNow.value
      relayStartingWindow.value = {
        startedAt: anchorMs,
        endsAt: anchorMs + store.config.game.startingCountdownSeconds * 1_000,
      }
    },
    { immediate: true },
  )
  /**
   * 本阶段截止时间（模式无关口径）：接龙视图与经典对局视图各有一份、互斥；
   * 接龙开局倒计时期两者都没有，才回落到上面的展示用本地窗口。
   */
  const phaseEndsAt = computed(
    () =>
      relay.value?.phaseEndsAt ?? game.value?.phaseEndsAt ?? relayStartingWindow.value?.endsAt ?? 0,
  )
  /** 本阶段起始时间（进度条分母）：口径与 `phaseEndsAt` 完全对称。 */
  const phaseStartedAt = computed(
    () =>
      relay.value?.phaseStartedAt ??
      game.value?.phaseStartedAt ??
      relayStartingWindow.value?.startedAt,
  )
  // 剩余秒数：按服务端权威截止时间向上取整；暂停状态下固定使用服务端下发的冻结剩余时间，避免随本地时钟持续扣减到 0
  const secondsLeft = computed(() => {
    if (store.room?.phase === 'paused') {
      return Math.max(0, Math.ceil((game.value?.pausedRemainingMs ?? 0) / 1_000))
    }
    return phaseEndsAt.value
      ? Math.max(0, Math.ceil((phaseEndsAt.value - correctedNow.value) / 1_000))
      : 0
  })
  // 阶段进度：剩余毫秒 / 阶段总时长，用于进度条 scaleX；暂停状态下固定使用冻结的剩余进度
  const progress = computed(() => {
    if (store.room?.phase === 'paused') {
      const total = (game.value?.phaseEndsAt ?? 0) - (game.value?.phaseStartedAt ?? 0)
      if (total <= 0) return 0
      return Math.max(0, Math.min(1, (game.value?.pausedRemainingMs ?? 0) / total))
    }
    const phaseStart = phaseStartedAt.value
    if (!phaseEndsAt.value || !phaseStart || phaseEndsAt.value <= phaseStart) return 0
    return Math.max(
      0,
      Math.min(1, (phaseEndsAt.value - correctedNow.value) / (phaseEndsAt.value - phaseStart)),
    )
  })
  /**
   * 当前玩家是否可提交输入：经典＝作画阶段且未猜中（或本人是画家）且在线；
   * 接龙＝对局进行中且在线——接龙聊天面板只发送聊天，作答与聊天分离（S20 / S79）。
   */
  const canGuess = computed(() => {
    const me = store.me
    if (!me || !isOnlineActiveMember(me)) return false
    if (store.room?.gameMode === 'relay')
      return relay.value !== undefined && relay.value.phase !== 'game_result'
    return store.room?.phase === 'drawing' && (store.isDrawer || !me.guessed)
  })

  // ---- 接龙派生（S74 / §八）：顶栏正中的题面、棒次与上一家 chip ----
  /**
   * 正中的题面文本：作画棒＝本棒要画的东西（步 1 自己选的词、步 3 上家的猜词文本），
   * 猜词棒＝「看图猜词」（玩家此时看到的是一幅画），其余阶段没有单句题面（选词被遮罩盖住、
   * 复盘与终局由各自的内容接管），回落到「等待选词…」占位。
   */
  const relayPrompt = computed(() => {
    const view = relay.value
    if (view?.phase === 'relay_guess') return strings.ui.game.relayGuessPrompt
    if (view?.phase === 'relay_draw') return view.prompt ?? strings.ui.game.awaitingWord
    return strings.ui.game.awaitingWord
  })
  /** 题面形态：猜词棒是提示语（配眼睛图标），作画棒是真正要画的词（高亮）。 */
  const relayPromptKind = computed<'question' | 'text'>(() =>
    relay.value?.phase === 'relay_guess' ? 'question' : 'text',
  )
  /**
   * 上一家 chip：步 2/4＝画那幅画的人、步 3＝给出文本的出题者、步 1 没有上一家（不下发，不渲染）。
   * `relayArtistPaints` 即画笔角标语义——只表达「此人在这一段里动手画了」。
   */
  const relayArtist = computed<RelayPlayerRef | undefined>(() => relay.value?.previousArtist)
  const relayArtistPaints = computed(() => relay.value?.phase === 'relay_guess')
  /** 棒次（1–4）：顶栏「第 N 棒 / 共 4 棒」胶囊用。 */
  const relayStep = computed(() => relay.value?.currentStep ?? 0)

  // ---- 接龙左栏状态（S41 / S64）：动手期＝提交进度、投票期＝投票进度、展示与终局不表达 ----
  const relayStatusMode = computed<'submit' | 'vote' | 'none'>(() => {
    const phase = relay.value?.phase
    if (phase === 'relay_choose' || phase === 'relay_draw' || phase === 'relay_guess')
      return 'submit'
    if (phase === 'relay_vote') return 'vote'
    return 'none'
  })
  /** 已动作玩家 id 集合（动手期＝本步已提交者、投票期＝该链已投票者）。 */
  const relaySubmittedIds = computed<ReadonlySet<string>>(
    () => new Set(relay.value?.submittedPlayerIds ?? []),
  )
  /** 复盘链进度（第 k / N 条链）：非复盘期不下发，故为 undefined。 */
  const relayChainProgress = computed(() => {
    const showcase = relay.value?.showcase
    return showcase ? { index: showcase.chainIndex, total: showcase.chainCount } : undefined
  })

  // 阶段中文标签（画布状态遮罩 / 各面板复用；映射与文案统一来自 utils/phase-text）
  const phaseLabel = computed(() => phaseTextFor(store.room?.phase))
  // 最终排行：按分数降序并计算同名次（同分并列）
  const rankings = computed<RankedMember[]>(() => {
    // game_result 优先读取服务端在结算瞬间冻结的榜单；旧快照缺少该字段时才回退实时成员。
    if (store.room?.phase === 'game_result' && game.value?.finalRanking)
      return game.value.finalRanking
    const members = [...(store.room?.members ?? [])].sort((a, b) => b.score - a.score)
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

  // correctedNow / phaseStartedAt / relayStartingWindow 只在内部被 secondsLeft 与 progress 使用，
  // 不作为对外返回值暴露（GameView 不消费它们）。
  return {
    game,
    relay,
    phaseEndsAt,
    secondsLeft,
    progress,
    canGuess,
    phaseLabel,
    rankings,
    // 接龙派生（经典房为缺省值：题面占位、棒次 0、状态 none、无链进度）
    relayStep,
    relayPrompt,
    relayPromptKind,
    relayArtist,
    relayArtistPaints,
    relayStatusMode,
    relaySubmittedIds,
    relayChainProgress,
  }
}
