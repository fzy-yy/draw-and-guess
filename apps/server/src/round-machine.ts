/**
 * 回合流转状态机：开局、选词、作画、结算、暂停/恢复、弃权与逐步提示。
 * 与实现 RoundContext 的应用服务组合使用（只注入房间/成员所需的窄接口），
 * 便于把“回合规则”与“会话/成员/传输”职责分离、独立单测。
 */
import { APP_CONFIG } from './config/index.ts'
import { createHintSchedule } from './hint-scheduler.ts'
import { serverStrings } from '@draw-guess/strings'
import {
  canTransition,
  isPunctuationOrSpace,
  type ChatMessage,
  type RoomPhase,
  type RoundResult,
  type VocabularyWord,
} from '@draw-guess/shared'
import type { GameSecret, MemberState, RoomSecret } from './models.ts'
import { buildDrawerScore, buildGuessDetail, freezeFinalRanking } from './scoring.ts'
import type { TimerHandle } from './runtime.ts'
import type { RoundContext } from './domain/game/round-context.ts'
import { selectDiverseCandidates } from './domain/vocabulary/candidate-selector.ts'
import {
  createEmptyMemberStats,
  createOnlineLookup,
  isOnlinePlayer,
  isRematchEligible,
  nicknameOf,
  nominalPhaseDurationMs,
  onlineGuessers,
  rematchEligibleMembers,
  type OnlineLookup,
} from './domain/room/member-facts.ts'
import { isPausablePhase, isRoundSettlePhase } from './domain/room/phase-facts.ts'
import { reseatMembers } from './domain/room/room-facts.ts'
import { invalidateCanvasSync } from './domain/drawing/canvas-sync.ts'
import { GameError, runtimeErrorType } from './errors.ts'

/** 回合流转状态机；只操作房间的 game 与阶段，不直接接触 socket。 */
export class RoundMachine {
  /** 连通性查询：从成员事实单一口径构造（在构造函数体赋值，避开字段初始化早于参数属性的顺序）。 */
  private readonly isOnline: OnlineLookup

  constructor(private readonly service: RoundContext) {
    this.isOnline = createOnlineLookup(this.service.players)
  }

  /**
   * 画家在选词阶段离开/掉线时废弃当前回合，立即进入下一回合选词。
   * 先把阶段切到 round_result（从 choosing_word 或 paused 出发的合法转换，见 LEGAL_PHASES），
   * 并清除暂停残留字段后再走统一开局流程，避免选词计时器空转导致整轮挂起。
   * 调用方：leaveRoom/leaveGame（含「暂停中选词」场景）与选词超时兜底。
   */
  public abandonChoosing(room: RoomSecret, notice: string): void {
    const game = this.service.requireGame(room)
    this.service.scheduler.clear(game.timer)
    // 清掉暂停现场（若之前在暂停态），保证后续状态干净
    delete game.pauseState
    this.transition(room, 'round_result')
    this.addSystemNotice(room, notice)
    this.beginChoosing(room)
  }
  /**
   * 开局倒计时入口（GameSecret 的唯一诞生地）：由请求边界校验通过后调用。
   * 构造本局秘密状态骨架并安排倒计时；对局秘密状态的诞生、时序写入与清理
   * 全部归本状态机所有（见 docs/adr/0024-round-machine-ownership.md）。
   */
  public beginStarting(room: RoomSecret, activeMembers: MemberState[]): void {
    this.transition(room, 'starting')
    const gameId = this.service.random.uuid()
    const now = this.service.clock.now()
    const countdownMs = APP_CONFIG.game.startingCountdownSeconds * 1_000
    const game: GameSecret = {
      id: gameId,
      startedAt: now,
      roundId: '',
      phaseStartedAt: now,
      phaseEndsAt: now + countdownMs,
      currentRound: 0,
      totalRounds: activeMembers.length * room.settings.roundsPerPlayer,
      // 单回合时长只由房间规则决定，词条不再参与（见 docs/adr/0046-*）
      roundDurationMs: room.settings.drawSeconds * 1_000,
      drawerOrder: this.shuffle(activeMembers.map((member) => member.playerId)),
      drawerId: '',
      candidates: [],
      offeredWordIds: new Set(),
      strokes: [],
      strokePointTotal: 0,
      fillCount: 0,
      undoneStrokeIds: [],
      lastSequence: -1,
      drawingRevision: 0,
      messages: [],
      correctOrder: [],
      correctDetails: [],
      revealedIndices: new Set(),
    }
    room.game = game
    game.timer = this.service.scheduler.set(countdownMs, () =>
      this.service.safeRun('startingCountdown', () => {
        // 倒计时期间房间可能被关闭或阶段被推进；只在仍是本局 starting 时开局
        if (room.phase !== 'starting' || room.game?.id !== gameId) return
        this.beginGame(room)
      }),
    )
  }
  public beginGame(room: RoomSecret): void {
    this.service.scheduler.clear(room.game?.timer)
    // 重置全员准备位与局内得分状态，进入第一回合选词
    room.members.forEach((member) => {
      member.ready = false
      resetMemberScoreState(member)
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
    const drawer = this.findNextDrawer(room, game)
    if (!drawer) {
      this.finishGame(room, serverStrings.notices.noDrawerAvailable)
      return
    }
    // 初始化本轮：先统一重置回合级状态（字段全集单点维护），再写入本回合特有字段
    this.transition(room, 'choosing_word')
    this.resetRoundState(room, game)
    game.drawerId = drawer // 指定当前画家（在切阶段后立即赋值）
    game.roundId = this.service.random.uuid()
    game.candidates = this.pickCandidates(room, game)
    game.rerollUsed = false
    game.phaseStartedAt = this.service.clock.now()
    // 选词阶段是否计时由房间规则决定；关闭时 phaseEndsAt = 0 是本项目「本阶段无截止时间」
    // 的哨兵（与暂停期同义），不排计时器、不自动代选——画家可以一直想，
    // 唯一的自动兜底是画家离开/掉线（见 abandonChoosing 的调用方）。
    this.service.scheduler.clear(game.timer)
    if (room.settings.allowChooseTimeLimit) {
      const chooseMs = room.settings.chooseSeconds * 1_000
      game.phaseEndsAt = game.phaseStartedAt + chooseMs
      // 选词超时：服务端随机选择一个候选词并直接开画。
      // 候选池按规则在开局前已校验充足（resetWhenExhausted 保障轮转），正常不会为空；
      // 此处仍作防御：极端情况下（词库被掏空）走弃权流程作废本回合，避免房间滞留 choosing_word。
      // abandonChoosing 会递归 beginChoosing 并推进回合序号，最终回合耗尽即进入最终结算，递归有界。
      game.timer = this.service.scheduler.set(chooseMs, () =>
        this.service.safeRun('choosingTimeout', () => {
          if (room.phase !== 'choosing_word') return
          const candidate = this.autoPickCandidate(game)
          if (candidate) this.beginDrawing(room, candidate)
          else this.abandonChoosing(room, serverStrings.notices.candidatesExhausted)
        }),
      )
    } else {
      game.phaseEndsAt = 0
      game.timer = undefined
    }
    this.service.emitRoom(room.id)
  }
  /**
   * 回合级状态重置：字段全集只在这里维护，beginChoosing 每个回合都经此清场
   * （beginStarting 构造骨架后也立即调用一次，保证首回合与后续回合同一清场口径）。
   * 新增 GameSecret 回合字段时必须登记到这里，否则会跨回合残留
   * （例如漏重置 fillCount 会让上一回合的填充预算吞掉新回合额度）。
   */
  private resetRoundState(room: RoomSecret, game: GameSecret): void {
    game.answer = undefined
    game.strokes = []
    game.strokePointTotal = 0 // 新回合重置画布点数预算
    game.fillCount = 0 // 新回合重置填充次数预算
    game.undoneStrokeIds = []
    game.lastSequence = -1
    game.messages = []
    game.correctOrder = []
    game.correctDetails = [] // 新回合重置得分明细
    game.revealedIndices = new Set()
    game.roundResult = undefined
    room.members.forEach((member) => (member.guessedAt = undefined))
    // 新回合从空画布开始：重置全员绘图差分游标，保证本回合首份快照始终携带完整（空）画布，
    // 不沿用上一回合的高水位序号（否则新回合第一条笔画可能被误判为「已同步」而差分省略）。
    invalidateCanvasSync(room)
  }
  public beginDrawing(room: RoomSecret, answer: { id: string; text: string }): void {
    const game = this.service.requireGame(room)
    this.service.scheduler.clear(game.timer)
    this.transition(room, 'drawing')
    // 富答案直接取自候选池：「answer 必在 candidates 内」由三条调用路径保证
    // （chooseWord 的 find、选词超时与暂停恢复的 candidates 取值）；
    // 若不变式被破坏则显式失败，绝不伪造字段——那会静默失真别称与分类。
    const richAnswer = game.candidates.find((candidate) => candidate.id === answer.id)
    if (!richAnswer) throw new GameError('INTERNAL_ERROR')
    game.answer = richAnswer
    game.offeredWordIds.add(answer.id) // 记录已展示词条，避免整局后续回合重复
    // 单回合时长只由房间规则决定：词条难度派生的时限已移除，不再按答案调整
    //（见 docs/adr/0046-vocabulary-slimming-and-unified-round-time.md）。
    game.roundDurationMs = room.settings.drawSeconds * 1_000
    game.phaseStartedAt = this.service.clock.now()
    game.phaseEndsAt = this.service.clock.now() + game.roundDurationMs
    // 作画倒计时结束进入回合结算
    game.timer = this.service.scheduler.set(game.roundDurationMs, () =>
      this.service.safeRun('drawingTimeout', () => this.finishRound(room, false)),
    )
    this.scheduleHints(room) // 若开启逐步提示则安排揭示计时器
    this.addSystemNotice(room, serverStrings.notices.drawingStarted)
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
    this.addMessage(room, {
      type: 'correct',
      text: serverStrings.notices.guessCorrect(
        nicknameOf(this.service.players, member.playerId, serverStrings.notices.fallbackPlayerName),
      ),
      playerId: member.playerId,
    })
    // 所有有效猜词者（可玩成员，排除观战）都已猜中时立即结束本回合，否则刷新房间快照
    const eligible = onlineGuessers(room, game.drawerId, this.isOnline)
    if (eligible.length > 0 && eligible.every((candidate) => candidate.guessedAt))
      this.finishRound(room, false)
    else this.service.emitRoom(room.id)
  }
  public finishRound(room: RoomSecret, drawerAbandoned: boolean): void {
    const game = room.game
    // 只有未结算的回合进行中（含暂停且暂停前确为 drawing）且答案已定时才结算；
    // roundResult 是「已结算」的唯一事实（roundSettled 双标志已合并，见 ADR-0024 的时序收口）。
    if (!game || !game.answer || game.roundResult) return
    if (room.phase === 'paused' && game.pauseState?.phase !== 'drawing') return
    if (!isRoundSettlePhase(room.phase)) return

    // 先转换阶段（非法转换在此抛出且现场未动），再清理计时器与暂停现场：
    // 顺序反了会留下「计时器已清但阶段未推进」的无计时器僵死回合。
    // paused → round_result 是领域允许的真实转换；无需伪造一次未记录的 drawing 中间阶段。
    const wasPaused = room.phase === 'paused'
    this.transition(room, 'round_result')
    this.clearHintTimers(game)
    this.service.scheduler.clear(game.timer)
    if (wasPaused) delete game.pauseState
    // 直接取用猜中当时入账的明细，不事后重算：重算会因暂停/恢复重置 phaseStartedAt
    // （使 elapsedMs 变负）或因成员中途离开改变可玩人数（使顺序奖归零），
    // 导致结算展示的分数与实际入账不一致。
    const details = [...game.correctDetails]
    // 画家得分：每个猜中者计一件，全员猜中另有满员奖励（均排除观战成员，scoring 模块统一）
    const drawerScore = buildDrawerScore({ game, room, drawerAbandoned })
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
    this.clearHintTimers(game)
    this.service.scheduler.clear(game.timer)
    // 排行必须在首次进入最终结算时一次性冻结；冻结规则见 scoring.freezeFinalRanking。
    if (!game.finalRanking) game.finalRanking = freezeFinalRanking(room, this.service.players)
    // paused → game_result 是领域允许的真实转换；直接结算并清理暂停现场。
    if (room.phase === 'paused') delete game.pauseState
    if (room.phase !== 'game_result') this.transition(room, 'game_result')
    const now = this.service.clock.now()
    const minimumResultMs = APP_CONFIG.game.gameResultMinSeconds * 1_000
    // 即使未来配置误把自动上限设得更短，也绝不能绕过产品定义的最短展示期。
    const autoReturnMs = Math.max(
      minimumResultMs,
      APP_CONFIG.game.gameResultAutoReturnSeconds * 1_000,
    )
    game.phaseStartedAt = now
    game.gameResultMinEndsAt = now + minimumResultMs
    game.phaseEndsAt = now + autoReturnMs
    game.hostReturnRequested = false
    room.members.forEach((member) => {
      member.rematchReady = false
    })
    // 收敛回合显示：beginChoosing 先自增 currentRound 再判断是否超限，进入最终结算时
    // 回退到总回合数，避免结算界面 HUD 短暂显示「5 / 4」这类越界数字。
    game.currentRound = Math.min(game.currentRound, game.totalRounds)
    this.addSystemNotice(room, reason)
    // 战绩落盘：进入最终结算时把冻结的最终排名与玩家结果写入 SQLite（低频，无性能顾虑）。
    // 若落盘异常，记录错误并确保结算广播正常发出，客户端不因数据库错误卡死。
    try {
      this.service.persistGameResult(room, reason)
    } catch (err) {
      this.service.logger.error(
        { errorType: runtimeErrorType(err), roomId: room.id },
        '战绩落盘失败，已保障结算广播正常进行',
      )
    }
    // 最短展示期到点后统一评估全员/房主意愿；自动返回上限到点则无条件收敛到 waiting。
    game.rematchTimer = this.service.scheduler.set(minimumResultMs, () =>
      this.service.safeRun('gameResultMinimumElapsed', () => this.evaluateRematch(room)),
    )
    game.timer = this.service.scheduler.set(autoReturnMs, () =>
      this.service.safeRun('gameResultAutoReturn', () => {
        if (room.phase === 'game_result') {
          this.setWaiting(room, serverStrings.notices.backToRoom)
          this.service.broadcastPresence()
        }
      }),
    )
    this.service.emitRoom(room.id)
    this.service.broadcastPresence()
  }
  public pauseRoomInternal(room: RoomSecret, reason: string): void {
    // 只有选词/作画/回合结算可暂停；开局倒计时（starting）不在 paused 白名单内
    if (!this.isPausable(room.phase)) return
    const game = this.service.requireGame(room)
    // 先确认状态机允许，再动现场：否则清除倒计时后转换失败，会留下无计时器的僵死阶段
    if (!canTransition(room.phase, 'paused')) return
    this.clearHintTimers(game)
    this.service.scheduler.clear(game.timer)
    // 冻结当前阶段与剩余毫秒（成对写入 pauseState，半状态由类型消除），暂停期间所有计时停止
    game.pauseState = {
      phase: room.phase,
      remainingMs: Math.max(0, game.phaseEndsAt - this.service.clock.now()),
    }
    this.transition(room, 'paused')
    game.phaseEndsAt = 0
    this.addSystemNotice(room, reason)
  }
  /**
   * 恢复暂停：用暂停时冻结的剩余毫秒重建截止时间并继续原阶段。
   * 与 pauseRoomInternal 成对归本状态机所有（此前 resume 在 GameService，时序字段跨模块读写）；
   * 暂停现场由类型保证成对存在，无需对「半状态」兜底。
   */
  public resume(room: RoomSecret): void {
    const game = this.service.requireGame(room)
    const pauseState = room.phase === 'paused' ? game.pauseState : undefined
    if (!pauseState) throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_RESUME)
    const next = pauseState.phase
    // 先校验目标阶段合法，再清理暂停现场：否则转换失败会丢失 pauseState，房间无法再次恢复
    if (!canTransition(room.phase, next))
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_RESUME)
    // 标称总时长由 member-facts 单一口径给出（覆盖全部可暂停阶段）；重建后的已用时间
    // 保持暂停时刻的进度，客户端倒计时与进度条从冻结值继续（而非从 0 重走）。
    const totalDurationMs = nominalPhaseDurationMs(next, game, room.settings)
    if (totalDurationMs === undefined) {
      // 该阶段本就无截止时间（选词阶段关闭限时）：恢复后继续无限等待，
      // phaseEndsAt 保持哨兵 0，不重建倒计时。
      game.phaseStartedAt = this.service.clock.now()
      game.phaseEndsAt = 0
    } else {
      const effectiveElapsedMs = Math.max(0, totalDurationMs - pauseState.remainingMs)
      game.phaseStartedAt = this.service.clock.now() - effectiveElapsedMs
      game.phaseEndsAt = this.service.clock.now() + pauseState.remainingMs
    }
    delete game.pauseState
    this.transition(room, next)
    this.scheduleCurrentPhase(room)
  }
  public scheduleCurrentPhase(room: RoomSecret): void {
    const game = this.service.requireGame(room)
    // 暂停恢复后按冻结的剩余毫秒重新调度当前阶段计时器
    const delay = Math.max(0, game.phaseEndsAt - this.service.clock.now())
    this.service.scheduler.clear(game.timer)
    // 无截止时间的阶段（选词阶段关闭限时）不排计时器：恢复后仍无限等待
    if (game.phaseEndsAt === 0) return
    if (room.phase === 'choosing_word') {
      // 恢复选词阶段：超时后随机取一个候选词自动开画——与首轮超时同构，暂停恢复不改变自动选词行为；
      // 候选池为空时同样作废本回合
      game.timer = this.service.scheduler.set(delay, () =>
        this.service.safeRun('resumeChoosing', () => {
          const candidate = this.autoPickCandidate(game)
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
    const game = room.game
    this.transition(room, 'waiting')
    if (game) this.clearHintTimers(game)
    this.service.scheduler.clear(game?.timer)
    this.service.scheduler.clear(game?.rematchTimer)
    delete room.game
    room.members = room.members.filter((member) => !member.leftGame)
    reseatMembers(room)
    // next_game 候场成员只在真正进入下一局 waiting 时晋升；纯观战成员保持观战。
    room.members.forEach((member) => {
      member.rematchReady = false
      if (!member.waitingForNextGame) return
      member.waitingForNextGame = false
      member.spectating = false
      member.ready = false
      resetMemberScoreState(member)
    })
    if (resetReady) this.invalidateReady(room, notice, 'preserve')
    else this.addSystemNotice(room, notice)
    this.service.emitRoom(room.id)
  }

  /** 记录单个成员的再来一局意愿；重复和阶段迟到请求均按成功处理。 */
  public requestRematch(room: RoomSecret, member: MemberState): void {
    if (room.phase !== 'game_result' || !room.game) return
    if (!isRematchEligible(member)) return
    if (!member.rematchReady) {
      member.rematchReady = true
      room.stateVersion += 1
    }
    if (room.hostId === member.playerId) room.game.hostReturnRequested = true
    this.evaluateRematch(room)
  }

  /** 最短展示期后，房主请求或全部下一局有效成员就绪时一次性回到 waiting。 */
  public evaluateRematch(room: RoomSecret): void {
    const game = room.game
    if (room.phase !== 'game_result' || !game || game.gameResultMinEndsAt === undefined) return
    if (this.service.clock.now() < game.gameResultMinEndsAt) {
      this.service.emitRoom(room.id)
      return
    }
    const eligible = rematchEligibleMembers(room)
    if (
      game.hostReturnRequested ||
      (eligible.length > 0 && eligible.every((member) => member.rematchReady))
    ) {
      this.setWaiting(room, serverStrings.notices.backToRoom)
      this.service.broadcastPresence()
      return
    }
    // 最短期结束但尚未满足转换条件时刷新一次，让新房主的全局返回按钮解锁。
    this.service.emitRoom(room.id)
  }
  /**
   * 统一逐步提示调度：全部延迟由 hint-scheduler.ts 的 createHintSchedule 计算（单一事实来源），
   * 避免 round-machine 内联重抄一份逐步提示数学导致两处漂移。逐步提示在作画后半程按字符
   * 数逐步揭示；剩余不足时以 Math.max(0, …) 归零并立即揭示。
   */
  public scheduleHints(room: RoomSecret): void {
    const game = this.service.requireGame(room)
    this.clearHintTimers(game)
    if (!game.answer || room.phase !== 'drawing') return

    const totalMs = game.roundDurationMs
    const currentRemainingMs = Math.max(0, game.phaseEndsAt - this.service.clock.now())
    const timers: TimerHandle[] = []

    const schedule = createHintSchedule({
      totalMs,
      currentRemainingMs,
      progressiveHints: room.settings.progressiveHints,
      wordText: game.answer.text,
      revealedCount: game.revealedIndices.size,
    })

    for (const delay of schedule.progressiveDelays) {
      timers.push(
        this.service.scheduler.set(delay, () =>
          this.service.safeRun('revealHint', () => this.revealHint(room)),
        ),
      )
    }

    game.hintTimers = timers
  }

  private revealHint(room: RoomSecret): void {
    const game = room.game
    if (!game?.answer || room.phase !== 'drawing') return
    // 筛选出尚未揭示的非标点/空白字符作为待揭示候选
    const candidates = Array.from(game.answer.text)
      .map((character, index) => ({ character, index }))
      .filter(
        ({ character, index }) =>
          !isPunctuationOrSpace(character) && !game.revealedIndices.has(index),
      )
    // 只剩一个字符时不再揭示，避免答案被完全泄露
    if (candidates.length <= 1) return
    // 随机揭示其中一个字符下标
    const target = candidates[this.service.random.integer(candidates.length)]
    if (target) game.revealedIndices.add(target.index)
    this.service.emitRoom(room.id)
  }

  /**
   * 是否允许暂停。开局倒计时（starting）不在 `LEGAL_PHASES` 的 `paused` 白名单内：
   * 若允许暂停会先清除倒计时再转换失败，使房间永久停在无人推进的 starting。
   * 阶段白名单的唯一来源是 phase-facts（game-service / snapshot 共用同一口径）。
   */
  public isPausable(phase: RoomPhase): boolean {
    return isPausablePhase(phase)
  }

  /** Fisher-Yates 洗牌：随机打乱数组并返回新数组（不改原数组）。 */
  public shuffle<T>(values: T[]): T[] {
    const result = [...values]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = this.service.random.integer(index + 1)
      ;[result[index], result[target]] = [result[target] as T, result[index] as T]
    }
    return result
  }

  /** 候选词多样性抽样：保证候选词集合在难度（1~5星阶梯）和类别（无重复分类）上均匀随机分布。 */
  private sampleDiverseCandidates(pool: VocabularyWord[], count: number): VocabularyWord[] {
    const selected = selectDiverseCandidates({ pool: this.shuffle([...pool]), count })
    return pool.length <= count ? selected : this.shuffle(selected)
  }

  /**
   * 抽取本回合候选词：从本局已选词库中排除本局已展示过的词条（整局绝不重复），
   * 词池不足且配置允许时重置已展示记录；抽中的候选立即记录进 offeredWordIds。
   */
  public pickCandidates(room: RoomSecret, game: GameSecret): VocabularyWord[] {
    const store = this.service.getRoomVocabularyStore(room)
    let pool = [...room.selectedWordIds]
      .filter((id) => !game.offeredWordIds.has(id))
      .map((id) => store.byId.get(id))
      .filter((word): word is VocabularyWord => word !== undefined)

    if (pool.length < room.settings.optionCount && APP_CONFIG.vocabulary.resetWhenExhausted) {
      game.offeredWordIds.clear()
      pool = [...room.selectedWordIds]
        .map((id) => store.byId.get(id))
        .filter((word): word is VocabularyWord => word !== undefined)
    }

    const picked = this.sampleDiverseCandidates(pool, room.settings.optionCount)
    picked.forEach((word) => game.offeredWordIds.add(word.id))
    return picked
  }

  /**
   * 选词超时自动开画：从当前候选池随机取一个。
   * 首轮超时与暂停恢复后的超时共用本方法（暂停恢复不改变自动选词行为）；
   * 空池返回 undefined，由调用方走 abandonChoosing 作废本回合（正常不会发生，见 beginChoosing）。
   */
  private autoPickCandidate(game: GameSecret): VocabularyWord | undefined {
    return game.candidates.length
      ? game.candidates[this.service.random.integer(game.candidates.length)]
      : undefined
  }

  /** 从当前回合序号起，按开局洗牌顺序寻找第一位仍在房间、在线的可玩成员任画家（观战者跳过）。 */
  private findNextDrawer(room: RoomSecret, game: GameSecret): string | undefined {
    const start = game.currentRound - 1
    for (let offset = 0; offset < game.drawerOrder.length; offset += 1) {
      const candidate = game.drawerOrder[(start + offset) % game.drawerOrder.length]
      const member = room.members.find((item) => item.playerId === candidate)
      if (candidate && member && isOnlinePlayer(member, this.isOnline)) return candidate
    }
    return undefined
  }

  /** 执行合法的阶段转换；非法转换直接抛错，绝不自作主张切换。转换后版本号 +1。 */
  public transition(room: RoomSecret, next: RoomPhase): void {
    if (!canTransition(room.phase, next))
      throw new GameError(
        'INVALID_TRANSITION',
        serverStrings.errors.INVALID_TRANSITION(room.phase, next),
      )
    const previous = room.phase
    room.phase = next
    this.service.logger.info({ roomId: room.id, from: previous, to: next }, '房间阶段已转换')
    room.stateVersion += 1
  }

  /**
   * 规则变更后清空全员准备位并广播通知。
   * 阶段转换已经递增版本时使用 preserve，保证一次原子状态发布只占一个版本号。
   */
  public invalidateReady(
    room: RoomSecret,
    notice: string,
    versionMode: 'increment' | 'preserve' = 'increment',
  ): void {
    room.members.forEach((member) => (member.ready = false))
    if (versionMode === 'increment') room.stateVersion += 1
    this.addSystemNotice(room, notice)
  }

  /** 追加一条对局消息并裁剪队列，防止内存无限增长。 */
  public addMessage(room: RoomSecret, input: Omit<ChatMessage, 'id' | 'createdAt'>): void {
    const game = this.service.requireGame(room)
    game.messages.push({
      ...input,
      id: this.service.random.uuid(),
      createdAt: this.service.clock.now(),
    })
    // 队列上限为快照下发条数的 2 倍：多出一倍作为缓冲，保证快照 slice(-N) 总能取满
    // 最近 N 条（队列本身不会无限增长）。
    game.messages = game.messages.slice(-APP_CONFIG.ui.recentMessageCount * 2)
  }

  /** 系统通知：写入消息历史并作为独立事件推送（即使尚无对局也能收到）。 */
  public addSystemNotice(room: RoomSecret, text: string): void {
    if (room.game) this.addMessage(room, { type: 'system', text })
    this.service.emitSystemNotice(room.id, text)
  }

  /** 清理全部逐步提示计时器，防止暂停/切换阶段后旧回调误触发。 */
  public clearHintTimers(game: GameSecret): void {
    for (const timer of game.hintTimers ?? []) this.service.scheduler.clear(timer)
    game.hintTimers = []
  }
}

/**
 * 重置单个成员的局内得分状态（新局全员重置与候场晋升共用同一字段口径）。
 * 统计结构走 createEmptyMemberStats，新增统计字段时只改一处。
 */
function resetMemberScoreState(member: MemberState): void {
  member.score = 0
  member.guessedAt = undefined
  member.stats = createEmptyMemberStats()
}
