/**
 * 回合流转状态机：开局、选词、作画、结算、暂停/恢复、弃权与逐步提示。
 * 与 GameService 组合使用（注入 service 引用调用其房间/成员助手），
 * 便于把“回合规则”与“会话/成员/传输”职责分离、独立单测。
 */
import { randomUUID } from 'node:crypto'
import { APP_CONFIG } from '../../../config.ts'
import { serverStrings } from '../../../config/strings.ts'
import { EVENTS, canTransition, type FinalRankingEntry, type RoundResult } from '@draw-guess/shared'
import type { MemberState, RoomSecret } from './models.ts'
import type { GameService } from './game-service.ts'
import { buildDrawerScore, buildGuessDetail } from './scoring.ts'

/** 回合流转状态机；只操作房间的 game 与阶段，不直接接触 socket。 */
export class RoundMachine {
  constructor(private readonly service: GameService) {}

  /**
   * 画家在选词阶段离开/掉线时废弃当前回合，立即进入下一回合选词。
   * 先把阶段切到 round_result（从 choosing_word 出发的合法转换），再走统一的开局流程，
   * 避免选词计时器空转导致整轮挂起。
   */
  public abandonChoosing(room: RoomSecret, notice: string): void {
    const game = this.service.requireGame(room)
    if (game.timer) clearTimeout(game.timer)
    // 清掉暂停残留字段（若之前在暂停态），保证后续状态干净
    delete game.phaseBeforePause
    delete game.pausedRemainingMs
    this.service.transition(room, 'round_result')
    this.service.addSystemNotice(room, notice)
    this.beginChoosing(room)
  }
  public beginGame(room: RoomSecret): void {
    if (room.game?.timer) clearTimeout(room.game.timer)
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
    game.roundId = randomUUID()
    game.candidates = this.service.pickCandidates(room, game)
    game.answer = undefined
    game.strokes = []
    game.strokePointTotal = 0 // 新回合重置画布点数预算
    game.undoneStrokeIds = []
    game.lastSequence = -1
    game.messages = []
    game.correctOrder = []
    game.correctDetails = [] // 新回合重置得分明细
    game.revealedIndices = new Set()
    game.roundResult = undefined
    room.members.forEach((member) => (member.guessedAt = undefined))
    game.phaseStartedAt = Date.now()
    game.phaseEndsAt = Date.now() + room.settings.chooseSeconds * 1_000
    // 选词超时：服务端随机选择一个候选词并直接开画
    game.timer = setTimeout(
      () =>
        this.service.safeRun('choosingTimeout', () => {
          const candidate = game.candidates[Math.floor(Math.random() * game.candidates.length)]
          if (candidate && room.phase === 'choosing_word') this.beginDrawing(room, candidate)
        }),
      room.settings.chooseSeconds * 1_000,
    )
    this.service.emitRoom(room.id)
  }
  public beginDrawing(room: RoomSecret, answer: { id: string; text: string }): void {
    const game = this.service.requireGame(room)
    if (game.timer) clearTimeout(game.timer)
    this.service.transition(room, 'drawing')
    game.answer = answer
    game.usedWordIds.add(answer.id) // 记录已用词条，避免后续回合重复
    game.phaseStartedAt = Date.now()
    game.phaseEndsAt = Date.now() + room.settings.drawSeconds * 1_000
    // 作画倒计时结束进入回合结算
    game.timer = setTimeout(
      () => this.service.safeRun('drawingTimeout', () => this.finishRound(room, false)),
      room.settings.drawSeconds * 1_000,
    )
    this.scheduleHints(room) // 若开启逐步提示则安排揭示计时器
    this.service.addSystemNotice(room, serverStrings.notices.drawingStarted)
    this.service.emitRoom(room.id)
  }
  public markCorrect(room: RoomSecret, member: MemberState): void {
    const game = this.service.requireGame(room)
    if (member.guessedAt) return // 防重复计分
    member.guessedAt = Date.now()
    game.correctOrder.push(member.playerId)
    // 按可玩成员数（排除观战）计算速度奖励和顺序奖励，累加到成员总分（scoring 模块统一口径）
    const detail = buildGuessDetail({
      game,
      room,
      playerId: member.playerId,
      guessedAt: member.guessedAt,
      orderIndex: game.correctOrder.length,
      durationMs: room.settings.drawSeconds * 1_000,
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
    this.service.io
      .to(room.id)
      .emit(EVENTS.guessCorrect, { playerId: member.playerId, order: game.correctOrder.length })
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
    // 只有回合进行中（含暂停兜底）且答案已定时才结算
    if (!game || !game.answer || !['drawing', 'paused'].includes(room.phase)) return
    this.service.clearHintTimers(game)
    if (game.timer) clearTimeout(game.timer)
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
    const onlinePlayerIds = new Set(
      room.members
        .filter((member) => this.service.players.get(member.playerId)?.connected)
        .map((member) => member.playerId),
    )
    const drawerScoreInfo = buildDrawerScore({ game, room, onlinePlayerIds, drawerAbandoned })
    const drawerScore = drawerScoreInfo.score
    const drawer = room.members.find((member) => member.playerId === game.drawerId)
    if (drawer) {
      drawer.score += drawerScore
      drawer.stats.drawingCorrectCount += game.correctOrder.length
    }
    // 保存结算数据并开启 6 秒结算展示窗口，之后进入下一回合选词
    const result: RoundResult = { answer: game.answer.text, details, drawerScore }
    game.roundResult = result
    game.phaseStartedAt = Date.now()
    game.phaseEndsAt = Date.now() + APP_CONFIG.game.roundResultSeconds * 1_000
    game.timer = setTimeout(
      () => this.service.safeRun('roundResultTimeout', () => this.beginChoosing(room)),
      APP_CONFIG.game.roundResultSeconds * 1_000,
    )
    this.service.emitRoom(room.id)
  }
  public finishGame(room: RoomSecret, reason: string): void {
    const game = this.service.requireGame(room)
    this.service.clearHintTimers(game)
    if (game.timer) clearTimeout(game.timer)
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
    game.phaseStartedAt = Date.now()
    game.phaseEndsAt = 0
    // 收敛回合显示：beginChoosing 先自增 currentRound 再判断是否超限，进入最终结算时
    // 回退到总回合数，避免结算界面 HUD 短暂显示「5 / 4」这类越界数字。
    game.currentRound = Math.min(game.currentRound, game.totalRounds)
    this.service.addSystemNotice(room, reason)
    // 战绩落盘：进入最终结算时把冻结的最终排名与玩家结果写入 SQLite（低频，无性能顾虑）。
    this.service.persistGameResult(room, reason)
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
    if (game.timer) clearTimeout(game.timer)
    // 冻结当前阶段与剩余毫秒，暂停期间所有计时停止
    game.phaseBeforePause = room.phase
    game.pausedRemainingMs = Math.max(0, game.phaseEndsAt - Date.now())
    this.service.transition(room, 'paused')
    game.phaseEndsAt = 0
    this.service.addSystemNotice(room, reason)
  }
  public scheduleCurrentPhase(room: RoomSecret): void {
    const game = this.service.requireGame(room)
    // 暂停恢复后按冻结的剩余毫秒重新调度当前阶段计时器
    const delay = Math.max(0, game.phaseEndsAt - Date.now())
    if (game.timer) clearTimeout(game.timer)
    if (room.phase === 'choosing_word') {
      // 恢复选词阶段：超时后取第一个候选词自动开画
      game.timer = setTimeout(
        () =>
          this.service.safeRun('resumeChoosing', () => {
            const candidate = game.candidates[0]
            if (candidate) this.beginDrawing(room, candidate)
          }),
        delay,
      )
    } else if (room.phase === 'drawing') {
      game.timer = setTimeout(
        () => this.service.safeRun('resumeDrawing', () => this.finishRound(room, false)),
        delay,
      )
      this.scheduleHints(room) // 同时重建逐步提示计时器
    } else if (room.phase === 'round_result')
      game.timer = setTimeout(
        () => this.service.safeRun('resumeRoundResult', () => this.beginChoosing(room)),
        delay,
      )
  }
  public setWaiting(room: RoomSecret, notice: string, resetReady = true): void {
    // 把房间状态重置回等待：清理对局秘密、提示计时器与全员准备
    if (room.game) this.service.clearHintTimers(room.game)
    if (room.game?.timer) clearTimeout(room.game.timer)
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
   * 按剩余时间阈值安排逐步提示。
   * 剩余比例降到某个阈值以下时揭示一个非标点字符（如 [0.35, 0.2] 表示两次揭示），
   * 且每次揭示后仍保留至少一个字符未知，因此提示只缩小范围而不会直接泄露答案。
   */
  public scheduleHints(room: RoomSecret): void {
    const game = this.service.requireGame(room)
    this.service.clearHintTimers(game)
    if (!room.settings.progressiveHints || !game.answer || room.phase !== 'drawing') return
    const totalMs = room.settings.drawSeconds * 1_000
    const remainingRatio = Math.max(0, Math.min(1, (game.phaseEndsAt - Date.now()) / totalMs))
    game.hintTimers = APP_CONFIG.game.finalHintThresholds
      .filter((threshold) => threshold < remainingRatio)
      .map((threshold) =>
        setTimeout(
          () => this.service.safeRun('revealHint', () => this.revealHint(room)),
          Math.max(0, (remainingRatio - threshold) * totalMs),
        ),
      )
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
    const target = candidates[Math.floor(Math.random() * candidates.length)]
    if (target) game.revealedIndices.add(target.index)
    this.service.emitRoom(room.id)
  }
}
