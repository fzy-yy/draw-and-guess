/**
 * 回合流转状态机：开局、选词、作画、结算、暂停/恢复、弃权与逐步提示。
 * 与 GameService 组合使用（注入 service 引用调用其房间/成员助手），
 * 便于把“回合规则”与“会话/成员/传输”职责分离、独立单测。
 */
import { APP_CONFIG } from '../../../config/index.ts'
import { createHintSchedule } from './hint-scheduler.ts'
import { serverStrings } from '../../../string/index.ts'
import { canTransition, type FinalRankingEntry, type RoundResult } from '@draw-guess/shared'
import type { MemberState, RoomSecret } from './models.ts'
import type { GameService } from './game-service.ts'
import { buildDrawerScore, buildGuessDetail } from './scoring.ts'
import type { TimerHandle } from './runtime.ts'

/** 回合流转状态机；只操作房间的 game 与阶段，不直接接触 socket。 */
export class RoundMachine {
  constructor(private readonly service: GameService) {}

  /**
   * 画家在选词阶段离开/掉线时废弃当前回合，立即进入下一回合选词。
   * 先把阶段切到 round_result（从 choosing_word 或 paused 出发的合法转换，见 LEGAL_PHASES），
   * 并清除暂停残留字段后再走统一开局流程，避免选词计时器空转导致整轮挂起。
   * 调用方：leaveRoom/leaveGame（含「暂停中选词」场景）与选词超时兜底。
   */
  public abandonChoosing(room: RoomSecret, notice: string): void {
    const game = this.service.requireGame(room)
    this.service.scheduler.clear(game.timer)
    // 清掉暂停残留字段（若之前在暂停态），保证后续状态干净
    delete game.phaseBeforePause
    delete game.pausedRemainingMs
    this.service.transition(room, 'round_result')
    this.service.addSystemNotice(room, notice)
    this.beginChoosing(room)
  }
  public beginGame(room: RoomSecret): void {
    this.service.scheduler.clear(room.game?.timer)
    // 重置全员准备位、得分、猜中时间与统计，进入第一回合选词
    room.members.forEach((member) => {
      member.ready = false
      member.score = 0
      member.guessedAt = undefined
      member.stats = { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 }
    })
    this.beginChoosing(room)
    this.service.broadcastPresence()
  }
  public beginChoosing(room: RoomSecret): void {
    const game = this.service.requireGame(room)
    game.currentRound += 1
    // 全部回合完成则进入最终结算
    if (game.currentRound > game.totalRounds) {
      this.finishGame(room, serverStrings.notices.allRoundsDone)
      return
    }
    // 按顺序选下一个在线的画家；没有可用画家则提前结算
    const drawer = this.service.findNextDrawer(room, game)
    if (!drawer) {
      this.finishGame(room, serverStrings.notices.noDrawerAvailable)
      return
    }
    // 初始化本轮：随机候选词、空画布、空消息、重置猜中位
    this.service.transition(room, 'choosing_word')
    game.drawerId = drawer // 指定当前画家（在切阶段后立即赋值）
    game.roundId = this.service.random.uuid()
    game.candidates = this.service.pickCandidates(room, game)
    game.rerollUsed = false
    game.answer = undefined
    game.strokes = []
    game.strokePointTotal = 0 // 新回合重置画布点数预算
    game.undoneStrokeIds = []
    game.lastSequence = -1
    game.messages = []
    game.correctOrder = []
    game.correctDetails = [] // 新回合重置得分明细
    game.revealedIndices = new Set()
    game.hintOrder = [] // 结构化提示顺序在 beginDrawing（答案确定后）洗牌
    game.revealedHintCount = 0
    game.roundResult = undefined
    game.roundSettled = false
    room.members.forEach((member) => (member.guessedAt = undefined))
    game.phaseStartedAt = this.service.clock.now()
    game.phaseEndsAt = this.service.clock.now() + room.settings.chooseSeconds * 1_000
    // 新回合从空画布开始：重置全员绘图差分游标，保证本回合首份快照始终携带完整（空）画布，
    // 不沿用上一回合的高水位序号（否则新回合第一条笔画可能被误判为「已同步」而差分省略）。
    room.members.forEach((member) => (member.lastSyncedSeq = undefined))
    // 选词超时：服务端随机选择一个候选词并直接开画。
    // 候选池按规则在开局前已校验充足（resetWhenExhausted 保障轮转），正常不会为空；
    // 此处仍作防御：极端情况下（词库被掏空）走弃权流程作废本回合，避免房间滞留 choosing_word。
    // abandonChoosing 会递归 beginChoosing 并推进回合序号，最终回合耗尽即进入最终结算，递归有界。
    game.timer = this.service.scheduler.set(room.settings.chooseSeconds * 1_000, () =>
      this.service.safeRun('choosingTimeout', () => {
        if (room.phase !== 'choosing_word') return
        const candidate = game.candidates.length
          ? game.candidates[this.service.random.integer(game.candidates.length)]
          : undefined
        if (candidate) this.beginDrawing(room, candidate)
        else this.abandonChoosing(room, serverStrings.notices.candidatesExhausted)
      }),
    )
    this.service.emitRoom(room.id)
  }
  public beginDrawing(room: RoomSecret, answer: { id: string; text: string }): void {
    const game = this.service.requireGame(room)
    this.service.scheduler.clear(game.timer)
    this.service.transition(room, 'drawing')
    // 记录富答案：candidates 中的词条即含别称/分类/词条级时限，直接取用；
    // 兜底数据在极端情况下（候选被外部改动）保证不引用 undefined。
    const richAnswer = game.candidates.find((candidate) => candidate.id === answer.id) ?? {
      ...answer,
      aliases: [],
      category: '',
      difficulty: 0,
    }
    game.answer = richAnswer
    game.offeredWordIds.add(answer.id) // 记录已展示词条，避免整局后续回合重复
    // 回合实际时长：词条级 time_limit 覆盖房间统一作画秒数（可在配置关闭；钳制到合法区间）
    const configuredSeconds =
      APP_CONFIG.vocabulary.useWordTimeLimit && richAnswer.timeLimit
        ? richAnswer.timeLimit
        : room.settings.drawSeconds
    const seconds = Math.max(
      APP_CONFIG.game.drawSeconds.min,
      Math.min(APP_CONFIG.game.drawSeconds.max, configuredSeconds),
    )
    game.roundDurationMs = seconds * 1_000
    game.phaseStartedAt = this.service.clock.now()
    game.phaseEndsAt = this.service.clock.now() + game.roundDurationMs
    game.roundSettled = false
    // 结构化提示：词库已改为「单分类即提示」，每个答案只有一条提示（其分类），
    // 不再是数组下标洗牌。这里固定用一个揭示槽位（0 号）表示「将在时机揭示分类」，
    // 首条即唯一一条，且对全体猜词者一致（随快照下发）；分类为空时不开启提示。
    game.hintOrder = richAnswer.category ? [0] : []
    // 作画倒计时结束进入回合结算
    game.timer = this.service.scheduler.set(game.roundDurationMs, () =>
      this.service.safeRun('drawingTimeout', () => this.finishRound(room, false)),
    )
    this.scheduleHints(room) // 若开启逐步/结构化提示则安排揭示计时器
    this.service.addSystemNotice(room, serverStrings.notices.drawingStarted)
    this.service.emitRoom(room.id)
  }
  public markCorrect(room: RoomSecret, member: MemberState): void {
    const game = this.service.requireGame(room)
    if (member.guessedAt) return // 防重复计分
    member.guessedAt = this.service.clock.now()
    game.correctOrder.push(member.playerId)
    // 按可玩成员数（排除观战）计算速度奖励和顺序奖励，累加到成员总分（scoring 模块统一口径）
    const detail = buildGuessDetail({
      game,
      room,
      playerId: member.playerId,
      guessedAt: member.guessedAt,
      orderIndex: game.correctOrder.length,
      durationMs: game.roundDurationMs,
    })
    member.score += detail.total
    // 与入账同一条明细留存，供结算展示直接取用（见 GameSecret.correctDetails 说明）
    game.correctDetails.push(detail)
    member.stats.correctCount += 1
    member.stats.totalGuessMs += member.guessedAt - game.phaseStartedAt
    // 广播猜中消息与顺序信息（不含答案正文）
    this.service.addMessage(room, {
      type: 'correct',
      text: serverStrings.notices.guessCorrect(
        this.service.players.get(member.playerId)?.profile.nickname ??
          serverStrings.notices.fallbackPlayerName,
      ),
      playerId: member.playerId,
    })
    // 所有有效猜词者（可玩成员，排除观战）都已猜中时立即结束本回合，否则刷新房间快照
    const eligible = room.members.filter(
      (candidate) =>
        candidate.playerId !== game.drawerId &&
        !candidate.spectating &&
        !candidate.leftGame &&
        this.service.players.get(candidate.playerId)?.connected,
    )
    if (eligible.length > 0 && eligible.every((candidate) => candidate.guessedAt))
      this.finishRound(room, false)
    else this.service.emitRoom(room.id)
  }
  public finishRound(room: RoomSecret, drawerAbandoned: boolean): void {
    const game = room.game
    // 只有未结算的回合进行中（含暂停且暂停前确为 drawing）且答案已定时才结算；已结算的回合绝不二次结算
    if (!game || !game.answer || game.roundSettled || Boolean(game.roundResult)) return
    if (room.phase === 'paused' && game.phaseBeforePause !== 'drawing') return
    if (!['drawing', 'paused'].includes(room.phase)) return

    game.roundSettled = true
    this.service.clearHintTimers(game)
    this.service.scheduler.clear(game.timer)
    // 若从暂停态结算，先复位到 drawing 以走合法转换，并清理暂停残留字段
    if (room.phase === 'paused') {
      room.phase = 'drawing'
      delete game.phaseBeforePause
      delete game.pausedRemainingMs
    }
    this.service.transition(room, 'round_result')
    // 直接取用猜中当时入账的明细，不事后重算：重算会因暂停/恢复重置 phaseStartedAt
    // （使 elapsedMs 变负）或因成员中途离开改变可玩人数（使顺序奖归零），
    // 导致结算展示的分数与实际入账不一致。
    const details = [...game.correctDetails]
    // 画家得分：每个猜中者计一件，全员猜中另有满员奖励（均排除观战成员，scoring 模块统一）
    const drawerScoreInfo = buildDrawerScore({ game, room, drawerAbandoned })
    const drawerScore = drawerScoreInfo.score
    const drawer = room.members.find((member) => member.playerId === game.drawerId)
    if (drawer) {
      drawer.score += drawerScore
      drawer.stats.drawingCorrectCount += game.correctOrder.length
    }
    // 保存结算数据并开启 6 秒结算展示窗口，之后进入下一回合选词
    const result: RoundResult = { answer: game.answer.text, details, drawerScore }
    game.roundResult = result
    game.phaseStartedAt = this.service.clock.now()
    game.phaseEndsAt = this.service.clock.now() + APP_CONFIG.game.roundResultSeconds * 1_000
    game.timer = this.service.scheduler.set(APP_CONFIG.game.roundResultSeconds * 1_000, () =>
      this.service.safeRun('roundResultTimeout', () => this.beginChoosing(room)),
    )
    this.service.emitRoom(room.id)
  }
  public finishGame(room: RoomSecret, reason: string): void {
    const game = this.service.requireGame(room)
    this.service.clearHintTimers(game)
    this.service.scheduler.clear(game.timer)
    // 排行必须在首次进入最终结算时一次性冻结。之后 leaveRoom 会从 room.members 移除成员，
    // 但已公布的成绩属于本局历史，不能跟随当前房间席位继续变化。
    if (!game.finalRanking) {
      const rankedMembers = room.members
        .filter((member) => !member.spectating)
        .sort((left, right) => right.score - left.score || left.joinedAt - right.joinedAt)
      let previousScore: number | undefined
      let rank = 0
      game.finalRanking = rankedMembers.flatMap<FinalRankingEntry>((member, index) => {
        const player = this.service.players.get(member.playerId)
        const profile = member.leftProfile ?? player?.profile
        if (!profile) return []
        if (member.score !== previousScore) rank = index + 1
        previousScore = member.score
        return [
          {
            id: member.playerId,
            nickname: profile.nickname,
            avatarId: profile.avatarId,
            rank,
            score: member.score,
            stats: { ...member.stats },
          },
        ]
      })
    }
    // 从暂停态结束时要先回到暂停前阶段，再走合法转换到 game_result，并清理暂停字段
    if (room.phase === 'paused') {
      room.phase = game.phaseBeforePause ?? 'drawing'
      delete game.phaseBeforePause
      delete game.pausedRemainingMs
    }
    if (room.phase !== 'game_result') {
      if (!canTransition(room.phase, 'game_result')) room.phase = 'drawing'
      this.service.transition(room, 'game_result')
    }
    game.phaseStartedAt = this.service.clock.now()
    game.phaseEndsAt = 0
    // 收敛回合显示：beginChoosing 先自增 currentRound 再判断是否超限，进入最终结算时
    // 回退到总回合数，避免结算界面 HUD 短暂显示「5 / 4」这类越界数字。
    game.currentRound = Math.min(game.currentRound, game.totalRounds)
    this.service.addSystemNotice(room, reason)
    // 战绩落盘：进入最终结算时把冻结的最终排名与玩家结果写入 SQLite（低频，无性能顾虑）。
    // 若落盘异常，记录错误并确保结算广播正常发出，客户端不因数据库错误卡死。
    try {
      this.service.persistGameResult(room, reason)
    } catch (err) {
      this.service.logger.error({ err, roomId: room.id }, '战绩落盘失败，已保障结算广播正常进行')
    }
    this.service.emitRoom(room.id)
    this.service.broadcastPresence()
  }
  public pauseRoomInternal(room: RoomSecret, reason: string): void {
    // 只有选词/作画/回合结算可暂停；开局倒计时（starting）不在 paused 白名单内
    if (!this.service.isPausable(room.phase) || room.phase === 'paused') return
    const game = this.service.requireGame(room)
    // 先确认状态机允许，再动现场：否则清除倒计时后转换失败，会留下无计时器的僵死阶段
    if (!canTransition(room.phase, 'paused')) return
    this.service.clearHintTimers(game)
    this.service.scheduler.clear(game.timer)
    // 冻结当前阶段与剩余毫秒，暂停期间所有计时停止
    game.phaseBeforePause = room.phase
    game.pausedRemainingMs = Math.max(0, game.phaseEndsAt - this.service.clock.now())
    this.service.transition(room, 'paused')
    game.phaseEndsAt = 0
    this.service.addSystemNotice(room, reason)
  }
  public scheduleCurrentPhase(room: RoomSecret): void {
    const game = this.service.requireGame(room)
    // 暂停恢复后按冻结的剩余毫秒重新调度当前阶段计时器
    const delay = Math.max(0, game.phaseEndsAt - this.service.clock.now())
    this.service.scheduler.clear(game.timer)
    if (room.phase === 'choosing_word') {
      // 恢复选词阶段：超时后取第一个候选词自动开画；候选池为空时与超时路径同构作废本回合
      game.timer = this.service.scheduler.set(delay, () =>
        this.service.safeRun('resumeChoosing', () => {
          const candidate = game.candidates[0]
          if (candidate) this.beginDrawing(room, candidate)
          else this.abandonChoosing(room, serverStrings.notices.candidatesExhausted)
        }),
      )
    } else if (room.phase === 'drawing') {
      game.timer = this.service.scheduler.set(delay, () =>
        this.service.safeRun('resumeDrawing', () => this.finishRound(room, false)),
      )
      this.scheduleHints(room) // 同时重建逐步提示计时器
    } else if (room.phase === 'round_result')
      game.timer = this.service.scheduler.set(delay, () =>
        this.service.safeRun('resumeRoundResult', () => this.beginChoosing(room)),
      )
  }
  public setWaiting(room: RoomSecret, notice: string, resetReady = true): void {
    // 把房间状态重置回等待：清理对局秘密、提示计时器与全员准备
    if (room.game) this.service.clearHintTimers(room.game)
    this.service.scheduler.clear(room.game?.timer)
    delete room.game
    room.phase = 'waiting'
    if (resetReady) this.service.invalidateReady(room, notice)
    else {
      room.stateVersion += 1
      this.service.addSystemNotice(room, notice)
    }
    this.service.emitRoom(room.id)
  }
  /**
   * 优化后的猜词提示调度算法：
   * ① 逐步提示（Progressive Hints）：
   *    - 在作画时间后半程（由 progressiveHintRatio 配置，如 0.5 即后 50%）逐步给出；
   *    - 提示字符总数向下取整为字数的一半：Math.floor(wordLength / 2)；
   *    - 间隔时间为：(总时长 * progressiveHintRatio) / 提示总数；
   *    - 在对应剩余时间触发，每次随机公布答案中一个未揭示的非标点字符。
   * ② 结构化提示（Category Hint）：
   *    - 在倒计时剩余比例降到房间 hintStartRatio 时给出词语类别提示。
   */
  public scheduleHints(room: RoomSecret): void {
    const game = this.service.requireGame(room)
    this.service.clearHintTimers(game)
    if (!game.answer || room.phase !== 'drawing') return

    const totalMs = game.roundDurationMs
    const currentRemainingMs = Math.max(0, game.phaseEndsAt - this.service.clock.now())
    const timers: TimerHandle[] = []

    // ① 逐步提示：在后半程按字符数逐步揭示
    if (room.settings.progressiveHints) {
      const wordChars = Array.from(game.answer.text)
      const hintCount = Math.floor(wordChars.length / 2)
      if (hintCount > 0) {
        const totalSec = Math.floor(totalMs / 1_000)
        const windowSec = Math.floor(totalSec * APP_CONFIG.game.progressiveHintRatio)
        const intervalSec = Math.floor(windowSec / hintCount)
        const intervalMs = intervalSec * 1_000
        const hintsAlreadyRevealed = game.revealedIndices.size

        for (let k = 1; k <= hintCount; k += 1) {
          // 若该轮次提示之前已触发过（如暂停前已揭示），跳过避免重复触发
          if (k <= hintsAlreadyRevealed) continue

          const targetRemainingMs = intervalMs * (hintCount - k + 1)
          if (currentRemainingMs >= targetRemainingMs) {
            const delay = currentRemainingMs - targetRemainingMs
            timers.push(
              this.service.scheduler.set(delay, () =>
                this.service.safeRun('revealHint', () => this.revealHint(room)),
              ),
            )
          }
        }
      }
    }

    // ② 结构化提示：时间快结束时（默认剩余 15 秒）揭示分类
    if (
      room.settings.structuredHintsEnabled &&
      game.hintOrder.length > 0 &&
      game.revealedHintCount < game.hintOrder.length
    ) {
      const targetRemainingMs =
        currentRemainingMs -
        (createHintSchedule({
          totalMs,
          currentRemainingMs,
          progressiveHints: false,
          wordText: game.answer.text,
          revealedCount: game.revealedIndices.size,
          structuredHintsEnabled: true,
          hasStructuredHint: true,
          revealedHintCount: game.revealedHintCount,
          hintStartRatio: room.settings.hintStartRatio,
        }).structuredDelay ?? 0)
      if (currentRemainingMs >= targetRemainingMs) {
        const delay = currentRemainingMs - targetRemainingMs
        timers.push(
          this.service.scheduler.set(delay, () =>
            this.service.safeRun('revealStructuredHint', () => this.revealStructuredHint(room)),
          ),
        )
      } else {
        // 当前剩余时间已经不足指定秒数，立即揭示
        timers.push(
          this.service.scheduler.set(0, () =>
            this.service.safeRun('revealStructuredHint', () => this.revealStructuredHint(room)),
          ),
        )
      }
    }

    game.hintTimers = timers
  }

  /** 揭示结构化提示：词库单分类即提示，只会揭示一次（受房间规则开关门控）。 */
  private revealStructuredHint(room: RoomSecret): void {
    const game = room.game
    if (!game?.answer || room.phase !== 'drawing') return
    if (!room.settings.structuredHintsEnabled) return
    if (game.revealedHintCount >= game.hintOrder.length) return
    game.revealedHintCount += 1
    this.service.emitRoom(room.id)
  }
  public revealHint(room: RoomSecret): void {
    const game = room.game
    if (!game?.answer || room.phase !== 'drawing') return
    // 筛选出尚未揭示的非标点/空白字符作为待揭示候选
    const candidates = Array.from(game.answer.text)
      .map((character, index) => ({ character, index }))
      .filter(
        ({ character, index }) =>
          !/^[\p{P}\p{Z}\s]$/u.test(character) && !game.revealedIndices.has(index),
      )
    // 只剩一个字符时不再揭示，避免答案被完全泄露
    if (candidates.length <= 1) return
    // 随机揭示其中一个字符下标
    const target = candidates[this.service.random.integer(candidates.length)]
    if (target) game.revealedIndices.add(target.index)
    this.service.emitRoom(room.id)
  }
}
