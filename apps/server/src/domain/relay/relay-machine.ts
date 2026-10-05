/**
 * 接龙生命周期状态机（S55）：与经典 `RoundMachine` **平级**，只依赖窄端口
 *（`RelayContext`，与 `RoundContext` 同一哲学——不反向依赖整机服务）。
 *
 * 一局＝四个步骤（步 1/3 作画、步 2/4 猜词，环状顺延见 `relay-canvas-target`），每步再分成阶段：
 * - 开局：链数组按席位顺序建立（S11）、N 条链 = N 名开局玩家（S9），随后复用 `starting` 倒计时（S22）；
 * - 步 1 选词：全员同时从**自己那条链**的候选里挑（S31 / S35），可换一批、可自定义题目（S50）；
 *   全员选完**秒切**作画，倒计时结束仍未选的人由服务端**随机代选**（S40，绝不出现空白画布）；
 * - 步 1/3 作画：在某条链的第一幅 / 第二幅画布上动手（命令写入见工单 04 的通路），
 *   全员提交（`relay:submitDrawing`）或倒计时到即结算；步 1 进步 2、步 3 进步 4；
 * - 步 2/4 猜词：只提交文本、提交即锁定、**不进聊天流**（S3 / S20 / S23），步 2 进步 3、步 4 进复盘；
 * - 换手一律「全员提交即秒切」（S40）；掉队容错见下方 `refreshAutoSubmit` 与 `writeAutoSubmitProduct`；
 * - 步 4 结算后进入 `relay_showcase`：停止对局计时，按链发起人**席位顺序**（S11）逐条轮播——
 *   每条链两个半场，每半场「重播 → 停顿 → 揭晓」（S43），半场 2 揭晓后切入该链投票（`relay_vote`）；
 *   轮播完全自动、**不可干预**（S12），工单 08 在投票结束后调用 `beginShowcaseForChain` 继续下一条链。
 *
 * 阶段写入、准备失效、对局消息与全部计时器归本状态机所有，与经典的职责分工一致
 *（见 docs/adr/0024-round-machine-ownership.md）；
 * 接龙整体的服务端权威推进、策略分流与插槽式复用见 docs/adr/0058-relay-mode-authoritative-flow-and-reuse.md。
 */
import { APP_CONFIG } from '../../config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import {
  canTransition,
  normalizeAnswer,
  type ChatMessage,
  type RelayStep,
  type RelayVoteChoice,
  type RoomPhase,
  type VocabularyWord,
} from '@draw-guess/shared'
import type { MemberState, PlayerSecret, RoomSecret } from '../../models.ts'
import { GameError, runtimeErrorType, type RuntimeLogger } from '../../errors.ts'
import type { RuntimeDependencies } from '../../runtime.ts'
import type { VocabularyStore } from '../../vocabulary/index.ts'
import { selectDiverseCandidates } from '../vocabulary/candidate-selector.ts'
import {
  activePlayers,
  createEmptyMemberStats,
  isActivePlayer,
  isPhaseExpired,
} from '../room/member-facts.ts'
import { isRelayPlayPhase } from '../room/phase-facts.ts'
import {
  createRelayChainSecret,
  type RelayChainSecret,
  type RelayGameSecret,
} from './relay-models.ts'
import {
  freezeRelayFinalRanking,
  relayParticipantIndices,
  tallyChainVotes,
} from './relay-voting.ts'
import { relayChainIndexOf } from './relay-canvas-target.ts'
import {
  FIRST_SHOWCASE_CHAIN_INDEX,
  nextShowcasePage,
  showcasePageMs,
  type RelayShowcaseCursor,
} from './relay-showcase.ts'
import {
  isDrawingStep,
  RELAY_AUTO_SUBMIT_GUESS_TEXT,
  type RelayDrawingStep,
  type RelayGuessingStep,
} from './relay-steps.ts'

/**
 * RelayMachine 允许访问的最小端口。
 * 阶段写入、准备失效、对局消息与系统通知已归状态机自身所有；
 * 这里只保留运行时、地图读取与跨模块副作用出口（传输 / 安全执行）。
 */
export interface RelayContext {
  logger: RuntimeLogger
  clock: RuntimeDependencies['clock']
  scheduler: RuntimeDependencies['scheduler']
  random: RuntimeDependencies['random']
  /** 本局词库 Store（候选抽取用）；未绑定或缺省时由实现回退默认词库。 */
  getRoomVocabularyStore(room?: RoomSecret): VocabularyStore
  requireRelay(room: RoomSecret): RelayGameSecret
  /**
   * 玩家在场事实：`connected=false` 时给出最近一次断线时间。
   * 代交宽限以「断线时刻 + 短宽限」起算，不按进入本步的时刻起算（S8）：
   * 因此上一棒末尾掉线的人在下一棒仍享有完整的 20 秒窗口，而长期掉线者一进新步就被代交。
   */
  getPlayerPresence(playerId: string): { connected: boolean; disconnectedAt?: number }
  /** 推送 systemNotice 事件（系统通知的唯一传输出口）。 */
  emitSystemNotice(roomId: string, text: string): void
  emitRoom(roomId: string): void
  broadcastPresence(): void
  safeRun(label: string, action: () => void): void
  /** 本局成员身份只读视图：终局榜冻结时取昵称与头像（离局成员另用 leftProfile，S37）。 */
  players: ReadonlyMap<string, Pick<PlayerSecret, 'profile'>>
  /** 整局战报落盘（game_archive + game_results），`reason` 即结束原因（S25 / S38）。 */
  persistGameResult(room: RoomSecret, reason: string): void
  /** 回等待：清接龙局并复用经典的等待收敛（清计时器、移除离局成绩卡、重置准备位）。 */
  setWaiting(room: RoomSecret, notice: string): void
}

/** 接龙生命周期状态机；只操作房间的 `relay` 与阶段，不直接接触 socket。 */
export class RelayMachine {
  constructor(private readonly service: RelayContext) {}

  /**
   * 开局倒计时入口（`RelayGameSecret` 的唯一诞生地）：请求边界校验通过后调用。
   * 链数组按**席位顺序**建立（S11 的复盘轮播序），步骤 1 的全局步 id 在此生成——
   * 选词与作画共用同一个步 id（S53：每步一个 id，不是每阶段一个）。
   */
  public beginStarting(room: RoomSecret, roster: MemberState[]): void {
    this.transition(room, 'starting')
    const now = this.service.clock.now()
    const countdownMs = APP_CONFIG.game.startingCountdownSeconds * 1_000
    const relay: RelayGameSecret = {
      id: this.service.random.uuid(),
      startedAt: now,
      currentStep: 1,
      stepId: this.service.random.uuid(),
      phaseStartedAt: now,
      phaseEndsAt: now + countdownMs,
      chains: [...roster]
        .sort((left, right) => left.seatIndex - right.seatIndex)
        .map((member) => createRelayChainSecret(member.playerId)),
      stepSubmissions: new Set(),
      autoSubmitTimers: new Map(),
      messages: [],
    }
    room.relay = relay
    relay.timer = this.service.scheduler.set(countdownMs, () =>
      this.service.safeRun('relayStartingCountdown', () => {
        // 倒计时期间房间可能被关闭或阶段被推进；只在仍是本局 starting 时开局
        if (room.phase !== 'starting' || room.relay?.id !== relay.id) return
        this.beginGame(room)
      }),
    )
  }

  /**
   * 正式开局：重置全员准备位与局内得分后进入步 1 选词。
   * 得分重置与经典 `RoundMachine.beginGame` 同口径（成员状态零新增字段，S64）。
   */
  public beginGame(room: RoomSecret): void {
    this.clearStepTimers(room.relay)
    room.members.forEach((member) => {
      member.ready = false
      member.score = 0
      member.guessedAt = undefined
      member.stats = createEmptyMemberStats()
    })
    this.beginChoosing(room)
    this.service.broadcastPresence()
  }

  /**
   * 步 1 选词：全员**同时**从自己那条链的候选里挑（S12 / S31 / S35）。
   * 候选按链隔离抽取、不跨链去重；倒计时结束仍未选的人由服务端随机代选（S40）。
   */
  public beginChoosing(room: RoomSecret): void {
    const relay = this.requireRelay(room)
    this.clearStepTimers(relay)
    this.transition(room, 'relay_choose')
    relay.currentStep = 1
    relay.stepSubmissions.clear()
    relay.chains.forEach((chain) => {
      chain.rerollUsed = false
      chain.candidates = this.pickCandidates(room, chain)
    })
    const chooseMs = room.settings.relayChooseSeconds * 1_000
    relay.phaseStartedAt = this.service.clock.now()
    relay.phaseEndsAt = relay.phaseStartedAt + chooseMs
    this.scheduleStepTimeout(room, 'relayChooseTimeout')
    // 关键节点通知：开局（S65）
    this.addSystemNotice(room, serverStrings.notices.relayStarted)
    this.scheduleStepAutoSubmits(room, relay)
    this.service.emitRoom(room.id)
  }

  /**
   * 步 1 选词：把观看者本链的候选之一写成本链题面。
   * 该玩家随即计入「已提交」——全员选完由 `advanceIfComplete` 秒切作画（S40）。
   */
  public chooseWord(room: RoomSecret, playerId: string, stepId: string, wordId: string): void {
    const { relay, chain } = this.requireChoosingChain(room, playerId, stepId)
    const word = chain.candidates.find((candidate) => candidate.id === wordId)
    if (!word) throw new GameError('INVALID_WORD_ID', serverStrings.errors.INVALID_WORD_ID_CHOOSE)
    this.commitChainWord(relay, chain, word)
    this.advanceIfComplete(room, relay.stepId)
  }

  /** 换一批：为本链重抽候选（房间开启换一批时每链一次，与经典「每回合一次」同口径）。 */
  public rerollWordOptions(room: RoomSecret, playerId: string, stepId: string): void {
    const { chain } = this.requireChoosingChain(room, playerId, stepId)
    if (!room.settings.allowWordReroll)
      throw new GameError('REROLL_DISABLED', serverStrings.errors.REROLL_DISABLED)
    if (chain.rerollUsed)
      throw new GameError('REROLL_ALREADY_USED', serverStrings.errors.REROLL_ALREADY_USED)
    chain.candidates = this.pickCandidates(room, chain)
    chain.rerollUsed = true
    this.service.emitRoom(room.id)
  }

  /**
   * 自定义题目：合成词条直接成为本链题面（S50，词条的合法性与撞词判定复用经典出口）。
   * 与「选候选词」并列的第三条出口，同样立刻计入已提交。
   */
  public chooseCustomWord(
    room: RoomSecret,
    playerId: string,
    stepId: string,
    word: VocabularyWord,
  ): void {
    const { relay, chain } = this.requireChoosingChain(room, playerId, stepId)
    if (!room.settings.allowCustomWord)
      throw new GameError('FORBIDDEN', serverStrings.errors.CUSTOM_WORD_DISABLED)
    // 撞词判定与本链已展示过的词比较：候选池在本链的另一处用途（换一批）此时已不可达
    if (this.isDuplicateInChain(room, chain, word.text))
      throw new GameError('CUSTOM_WORD_DUPLICATE', serverStrings.errors.CUSTOM_WORD_DUPLICATE)
    chain.candidates = [word]
    this.commitChainWord(relay, chain, word)
    this.advanceIfComplete(room, relay.stepId)
  }

  /**
   * 进入作画棒（步 1/3）：重置本步提交集、写阶段与阶段时间，并播关键节点通知（S65）。
   * 步 1 的作画紧接同一步的选词（步 id 不变，S53），步 3 是新的一步（步 id 轮换）。
   * 步 1 画自己选的词（第一幅画布）、步 3 按上家猜出的文本画（第二幅画布，看不到上家的画，S35）——
   * 两者的题面与画布都由 `relay-canvas-target` / `relay-snapshot` 按 (观看者, 步号) 解析。
   */
  private beginDrawStep(room: RoomSecret, step: RelayDrawingStep): void {
    const relay = this.requireRelay(room)
    this.clearStepTimers(relay)
    // 步 1 的选词与作画是同一步（S53：每步一个 id，不是每阶段一个），只有换到步 3 才轮换步 id
    if (relay.currentStep !== step) relay.stepId = this.service.random.uuid()
    relay.currentStep = step
    relay.stepSubmissions.clear()
    this.transition(room, 'relay_draw')
    const drawMs = room.settings.relayDrawSeconds * 1_000
    relay.phaseStartedAt = this.service.clock.now()
    relay.phaseEndsAt = relay.phaseStartedAt + drawMs
    this.scheduleStepTimeout(room, 'relayDrawingTimeout')
    this.addSystemNotice(room, serverStrings.notices.relayStepStarted(step))
    this.scheduleStepAutoSubmits(room, relay)
    this.service.emitRoom(room.id)
  }

  /**
   * 提交本棒作画（`relay:submitDrawing`，S30）：只标记完成并锁定，交的是已有笔画。
   * 全员提交即取消剩余倒计时并结算本步（秒切下一棒）；重复提交由本方法以 ALREADY_SUBMITTED 拒绝。
   */
  public submitDrawing(room: RoomSecret, playerId: string, stepId: string): void {
    const relay = this.requireRelay(room)
    if (stepId !== relay.stepId)
      throw new GameError('STALE_DRAW_EVENT', serverStrings.errors.STALE_DRAW_EVENT_STROKE)
    if (room.phase !== 'relay_draw')
      throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER)
    if (isPhaseExpired(relay, this.service.clock.now()))
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    if (!this.isParticipant(relay, playerId))
      throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER)
    if (relay.stepSubmissions.has(playerId)) throw new GameError('ALREADY_SUBMITTED')
    relay.stepSubmissions.add(playerId)
    this.advanceIfComplete(room, relay.stepId)
  }

  /**
   * 提交本棒猜词（`relay:submitGuess`，S30）：写进「本棒那条链」的步 2 / 步 4 产出并锁定。
   * 只记录文本、不判对错、不计分、**不进聊天流**（S3 / S20）；文本上限与聊天同口径且禁止空提交（S15）。
   * 限频只依赖 binder 的请求级窗口：提交一旦锁定即不可重来，不另设事件级桶（与 `chat:say` 不同）。
   */
  public submitGuess(room: RoomSecret, playerId: string, stepId: string, rawText: string): void {
    const relay = this.requireRelay(room)
    // 顺序即优先级：旧包（客户端状态落后）最先 → 阶段 / 到期 / 越权 → 锁 → 内容合法性。
    // 已锁定的棒次优先于内容校验：重试的客户端应当拿到「已提交」而不是一条格式错误。
    if (stepId !== relay.stepId)
      throw new GameError('STALE_DRAW_EVENT', serverStrings.errors.STALE_DRAW_EVENT_STROKE)
    if (room.phase !== 'relay_guess')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_GUESS)
    if (isPhaseExpired(relay, this.service.clock.now()))
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    const step = relay.currentStep
    if (isDrawingStep(step))
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_GUESS)
    const chain = this.chainFor(relay, playerId, step)
    if (relay.stepSubmissions.has(playerId)) throw new GameError('ALREADY_SUBMITTED')
    const text = rawText.trim()
    if (!text || Array.from(text).length > APP_CONFIG.player.chatMaxLength)
      throw new GameError('INVALID_MESSAGE', serverStrings.errors.INVALID_MESSAGE_EMPTY)
    this.writeGuess(chain, step, text)
    relay.stepSubmissions.add(playerId)
    this.advanceIfComplete(room, relay.stepId)
  }

  /**
   * 玩家自由聊天（`chat:say`，S79）：聊天与作答彻底分离，永远不把作答带出去（S20）。
   * 纯空白（trim 后为空）与经典猜词同口径拒绝（`INVALID_MESSAGE_EMPTY`），不广播空气泡；
   * 长度上限已由协议 `SendChatSchema` 收窄，这里不再重复校验。
   */
  public chat(room: RoomSecret, playerId: string, rawText: string): void {
    this.requireRelay(room)
    const text = rawText.trim()
    if (!text) throw new GameError('INVALID_MESSAGE', serverStrings.errors.INVALID_MESSAGE_EMPTY)
    this.addMessage(room, { type: 'guess', text, playerId })
    this.service.emitRoom(room.id)
  }

  /**
   * 进入猜词棒（步 2/4）：生成**新步 id**、重置本步提交集、写阶段与阶段时间，并播关键节点通知（S65）。
   * 猜词者本棒只拿得到上家**最终提交的画**（只读，S18 / S35），题面与答案一律不下发（见 relay-snapshot）。
   */
  private beginGuessStep(room: RoomSecret, step: RelayGuessingStep): void {
    const relay = this.requireRelay(room)
    this.clearStepTimers(relay)
    relay.currentStep = step
    relay.stepId = this.service.random.uuid()
    relay.stepSubmissions.clear()
    this.transition(room, 'relay_guess')
    const guessMs = room.settings.relayGuessSeconds * 1_000
    relay.phaseStartedAt = this.service.clock.now()
    relay.phaseEndsAt = relay.phaseStartedAt + guessMs
    this.scheduleStepTimeout(room, 'relayGuessTimeout')
    this.addSystemNotice(room, serverStrings.notices.relayStepStarted(step))
    this.scheduleStepAutoSubmits(room, relay)
    this.service.emitRoom(room.id)
  }

  /**
   * 步 4 结算后进入复盘阶段（S22 / S23）：停止接龙对局计时，播「复盘开始」关键节点通知（S65），
   * 并从第 1 条链（席位最靠前的发起人，S11）的半场 1 重播页起跑轮播。
   */
  private beginShowcase(room: RoomSecret): void {
    const relay = this.requireRelay(room)
    this.transition(room, 'relay_showcase')
    this.addSystemNotice(room, serverStrings.notices.relayShowcaseStarted)
    this.startChainShowcase(room, relay, FIRST_SHOWCASE_CHAIN_INDEX)
  }

  /**
   * 复盘轮播的链入口（工单 08 的接管点）：某条链的投票结束后，用它继续展示下一条链（S23）。
   * 先校验链序号、再转换阶段——只从投票期可入（`relay_vote → relay_showcase` 是复盘期的合法边），
   * 非法调用在动游标与计时器之前就显式失败，绝不留下半套轮播现场。
   */
  public beginShowcaseForChain(room: RoomSecret, chainIndex: number): void {
    const relay = this.requireShowcaseChain(room, chainIndex)
    this.transition(room, 'relay_showcase')
    this.startChainShowcase(room, relay, chainIndex)
  }

  /** 链序号守卫：复盘轮播只认 1～N（N＝本局链数），越界说明调用方破坏了不变式。 */
  private requireShowcaseChain(room: RoomSecret, chainIndex: number): RelayGameSecret {
    const relay = this.requireRelay(room)
    if (
      !Number.isInteger(chainIndex) ||
      chainIndex < FIRST_SHOWCASE_CHAIN_INDEX ||
      chainIndex > relay.chains.length
    )
      throw new GameError('INTERNAL_ERROR')
    return relay
  }

  /**
   * 从某条链起跑展示（调用方已完成阶段转换）：清掉上一页 / 上一棒的计时器，播「第 k / N 条链」
   * 关键节点通知（S65），再起半场 1 的重播页。
   */
  private startChainShowcase(room: RoomSecret, relay: RelayGameSecret, chainIndex: number): void {
    this.clearStepTimers(relay)
    this.addSystemNotice(
      room,
      serverStrings.notices.relayChainShowcaseStarted(chainIndex, relay.chains.length),
    )
    // 每条链都从半场 1 的重播页起跑（S43）；半场 1＝第一幅画 + 第二棒答案
    this.beginShowcasePage(room, { chainIndex, half: 1, page: 'replay' })
  }

  /**
   * 起一页（重播 / 停顿 / 揭晓）：写权威游标与本页阶段时间（时长取自配置包，S43），排下一页的计时器。
   * 回调按「阶段 + 游标」复核：迟到的旧回调一律让路，绝不把新一页当成旧页再推进一次
   * （与对局期的步 id 守卫同一手法）。
   */
  private beginShowcasePage(room: RoomSecret, cursor: RelayShowcaseCursor): void {
    const relay = this.requireRelay(room)
    relay.showcase = cursor
    const pageMs = showcasePageMs(cursor.page)
    relay.phaseStartedAt = this.service.clock.now()
    relay.phaseEndsAt = relay.phaseStartedAt + pageMs
    relay.timer = this.service.scheduler.set(pageMs, () =>
      this.service.safeRun('relayShowcasePage', () => {
        const current = room.relay
        if (!current || room.phase !== 'relay_showcase') return
        const now = current.showcase
        // 迟到的旧回调一律让路：游标必须仍指向排这个计时器时的那一页
        if (
          !now ||
          now.chainIndex !== cursor.chainIndex ||
          now.half !== cursor.half ||
          now.page !== cursor.page
        )
          return
        this.advanceShowcase(room)
      }),
    )
    this.service.emitRoom(room.id)
  }

  /**
   * 一页到点：同半场内续到下一页；半场 2 的揭晓之后本链展示结束，切入该链投票（S43 / S23）。
   * 轮播**完全自动**：这里没有任何「跳过 / 提前结束」分支（S12），成员变动也不影响本函数。
   */
  private advanceShowcase(room: RoomSecret): void {
    const relay = this.requireRelay(room)
    const cursor = relay.showcase
    // 理论上不可达（进入复盘即写游标）；真出现残缺现场就停在本页，绝不猜一条链出来
    if (!cursor) return
    const next = nextShowcasePage(cursor.page, cursor.half)
    if (next) {
      this.beginShowcasePage(room, {
        chainIndex: cursor.chainIndex,
        half: next.half,
        page: next.page,
      })
      return
    }
    this.enterChainVote(room)
  }

  /**
   * 切入该链投票（S23）：游标**保留**在「半场 2 · 揭晓」——投票期的快照仍要展示这条链的两个答案与画作。
   * 写权威投票窗口（固定 `relay.voteSeconds`，S21）、播「投票开始」关键节点通知（S65），
   * 并排投票到点计时器：到点一律结算，**从不**因为「全员投完」提前公布（S21）。
   */
  private enterChainVote(room: RoomSecret): void {
    const relay = this.requireRelay(room)
    this.clearStepTimers(relay)
    this.transition(room, 'relay_vote')
    const voteMs = APP_CONFIG.relay.voteSeconds * 1_000
    relay.phaseStartedAt = this.service.clock.now()
    relay.phaseEndsAt = relay.phaseStartedAt + voteMs
    this.addSystemNotice(room, serverStrings.notices.relayVoteStarted)
    relay.timer = this.service.scheduler.set(voteMs, () =>
      this.service.safeRun('relayVoteTimeout', () => {
        // 迟到的旧回调一律让路（房间可能已关闭或已被结算）：只有仍在投票期才结算
        if (room.phase !== 'relay_vote' || room.relay?.id !== relay.id) return
        this.settleChainVote(room)
      }),
    )
    this.service.emitRoom(room.id)
  }

  /**
   * 收一票（`relay:vote`，S13 / S14）：只有赞同 / 不赞同（其它值在协议边界被 strict 拒绝），
   * 点下即**锁定**、重复投票被拒；票行按到达顺序追加并向全房公开（S42 匿名行）。
   * 投票者是本局链阵容成员（＝开局玩家）；离局 / 离房者不会再发请求，由结算按未投补票（S14）。
   */
  public vote(room: RoomSecret, playerId: string, choice: RelayVoteChoice): void {
    const relay = this.requireRelay(room)
    // 顺序即优先级：阶段 → 到期 → 投票权 → 是否已投（锁定优先于内容之外的任何事后校验）。
    if (room.phase !== 'relay_vote')
      throw new GameError('INVALID_PHASE', serverStrings.errors.INVALID_PHASE_VOTE)
    if (isPhaseExpired(relay, this.service.clock.now()))
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    const cursor = relay.showcase
    const chain = cursor ? relay.chains[cursor.chainIndex - 1] : undefined
    if (!chain || !this.isParticipant(relay, playerId))
      throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER)
    if (chain.votes.some((vote) => vote.playerId === playerId))
      throw new GameError('ALREADY_SUBMITTED', serverStrings.errors.ALREADY_VOTED)
    chain.votes.push({ playerId, choice })
    // 票行是全房实时可见的状态：递增版本号让客户端门禁接受这份快照（其他高频刷新不动版本号）
    room.stateVersion += 1
    this.service.emitRoom(room.id)
  }

  /**
   * 投票窗口到点：无弃权结算 + 推进（S13 / S14 / S23 / S42）。
   * 先给链阵容里仍未投的成员补一张不赞同（追加在票行末尾，离局 / 离房者同样按未投处理），
   * 再按同一份明细算票、冻结在链上并给 4 名参与者入账；随后「还有下一条链就继续轮播，否则进终局」。
   */
  private settleChainVote(room: RoomSecret): void {
    const relay = this.requireRelay(room)
    const cursor = relay.showcase
    // 残缺现场（投票期没有游标 / 链越界）：不猜一条链出来结算，也绝不卡住房间——直接进终局兜底
    const chain = cursor ? relay.chains[cursor.chainIndex - 1] : undefined
    if (!cursor || !chain) {
      this.finishGame(room, serverStrings.notices.relayFinished)
      return
    }
    for (const originPlayerId of relay.chains.map((candidate) => candidate.originPlayerId)) {
      if (chain.votes.some((vote) => vote.playerId === originPlayerId)) continue
      chain.votes.push({ playerId: originPlayerId, choice: 'disagree' })
    }
    const tally = tallyChainVotes(chain.votes)
    chain.result = tally
    if (tally.matched)
      this.creditChainParticipants(room, relay, cursor.chainIndex, tally.pointsPerParticipant)
    if (cursor.chainIndex < relay.chains.length) {
      this.beginShowcaseForChain(room, cursor.chainIndex + 1)
      return
    }
    this.finishGame(room, serverStrings.notices.relayFinished)
  }

  /**
   * 把本链的入账分发给 4 名参与者（S13）：参与者＝链 (发起人 + k) 的发起人（环状顺延，S9）。
   * 链位上已离房的成员不再有成绩卡，自然不入账；分数与终局统计都取结算时冻结的同一份明细。
   */
  private creditChainParticipants(
    room: RoomSecret,
    relay: RelayGameSecret,
    chainIndex: number,
    points: number,
  ): void {
    for (const participantIndex of relayParticipantIndices(relay.chains.length, chainIndex)) {
      const participant = relay.chains[participantIndex]
      if (!participant) continue
      const member = room.members.find(
        (candidate) => candidate.playerId === participant.originPlayerId,
      )
      if (member) member.score += points
    }
  }

  /**
   * 进入终局（S33 / S38 / S60）：与经典 `finishGame` 同口径的双时限结算——
   * 先冻结终局榜（只有名次、分数与接龙口径统计），再写最短展示期与无条件自动返回上限，
   * 播结束原因（同时是战报里记的结束原因），战报落盘（`mode = relay`，S25 / S59）。
   * 落盘异常不阻塞结算广播（与经典一致：数据库问题不该把房间卡在结算页）。
   */
  public finishGame(room: RoomSecret, reason: string): void {
    const relay = this.requireRelay(room)
    this.clearStepTimers(relay)
    if (!relay.finalRanking)
      relay.finalRanking = freezeRelayFinalRanking(room, relay, this.service.players)
    if (room.phase !== 'game_result') this.transition(room, 'game_result')
    const now = this.service.clock.now()
    const minimumResultMs = APP_CONFIG.game.gameResultMinSeconds * 1_000
    // 即使未来配置误把自动上限设得更短，也绝不能绕过产品定义的最短展示期。
    const autoReturnMs = Math.max(
      minimumResultMs,
      APP_CONFIG.game.gameResultAutoReturnSeconds * 1_000,
    )
    relay.phaseStartedAt = now
    relay.gameResultMinEndsAt = now + minimumResultMs
    relay.phaseEndsAt = now + autoReturnMs
    relay.hostReturnRequested = false
    room.members.forEach((member) => {
      member.rematchReady = false
    })
    this.addSystemNotice(room, reason)
    try {
      this.service.persistGameResult(room, reason)
    } catch (err) {
      // 与经典结算共用同一条脱敏日志（模式无关：落盘失败不阻塞结算广播）
      this.service.logger.error(
        { errorType: runtimeErrorType(err), roomId: room.id },
        '战绩落盘失败，已保障结算广播正常进行',
      )
    }
    relay.rematchTimer = this.service.scheduler.set(minimumResultMs, () =>
      this.service.safeRun('relayResultMinimumElapsed', () => this.evaluateRematch(room)),
    )
    relay.timer = this.service.scheduler.set(autoReturnMs, () =>
      this.service.safeRun('relayResultAutoReturn', () => {
        if (room.phase !== 'game_result') return
        this.service.setWaiting(room, serverStrings.notices.backToRoom)
        this.service.broadcastPresence()
      }),
    )
    this.service.emitRoom(room.id)
    this.service.broadcastPresence()
  }

  /** 记录单个成员的「再来一局」意愿；非结算期与重复请求都按成功处理（与经典同口径）。 */
  public requestRematch(room: RoomSecret, member: MemberState): void {
    const relay = room.relay
    if (room.phase !== 'game_result' || !relay) return
    if (!isActivePlayer(member)) return
    if (!member.rematchReady) {
      member.rematchReady = true
      room.stateVersion += 1
    }
    if (room.hostId === member.playerId) relay.hostReturnRequested = true
    this.evaluateRematch(room)
  }

  /**
   * 最短展示期后评估退场意愿（与 `docs/game-result-exit.md` 同口径）：
   * 房主已请求或全部可玩（未离局）成员都点了「再来一局」时一次性回等待；
   * 最短期未到只刷新快照（让新房主的全局返回按钮解锁）；自动返回上限由 `finishGame` 的第二个计时器兜底。
   */
  public evaluateRematch(room: RoomSecret): void {
    const relay = room.relay
    if (room.phase !== 'game_result' || !relay || relay.gameResultMinEndsAt === undefined) return
    if (this.service.clock.now() < relay.gameResultMinEndsAt) {
      this.service.emitRoom(room.id)
      return
    }
    const eligible = activePlayers(room)
    if (
      relay.hostReturnRequested ||
      (eligible.length > 0 && eligible.every((member) => member.rematchReady))
    ) {
      this.service.setWaiting(room, serverStrings.notices.backToRoom)
      this.service.broadcastPresence()
      return
    }
    this.service.emitRoom(room.id)
  }

  /**
   * 排本阶段的超时兜底计时器（S8 的「本步倒计时先到」）。
   * 回调按**排程时的阶段 + 步 id**复核：迟到的旧回调一律让路，绝不把新一棒误结算；
   * 到点先把仍未交的成员按代交口径补齐，再按阶段换手——任何一棒都不会卡死。
   */
  private scheduleStepTimeout(room: RoomSecret, label: string): void {
    const relay = this.requireRelay(room)
    const phase = room.phase
    const stepId = relay.stepId
    const remainingMs = Math.max(0, relay.phaseEndsAt - this.service.clock.now())
    relay.timer = this.service.scheduler.set(remainingMs, () =>
      this.service.safeRun(label, () => {
        const current = room.relay
        if (!current || current.stepId !== stepId || room.phase !== phase) return
        this.autoSubmitRemaining(current)
        this.advanceAfterCurrentPhase(room)
      }),
    )
  }

  /** 全员提交即**秒切**下一棒（S40）：未满只刷新快照；满了按当前阶段换手（取消剩余倒计时）。 */
  private advanceIfComplete(room: RoomSecret, stepId: string): void {
    const relay = room.relay
    if (!relay || relay.stepId !== stepId) return
    if (!this.allSubmitted(relay)) {
      this.service.emitRoom(room.id)
      return
    }
    this.advanceAfterCurrentPhase(room)
  }

  /**
   * 本阶段完成后的换手（步号与阶段共同决定下一棒，S22）：
   * 选词 → 步 1 作画；步 1 作画 → 步 2 猜词；步 2 猜词 → 步 3 作画；步 3 作画 → 步 4 猜词；
   * 步 4 猜词 → 复盘。步号与阶段不匹配说明调用方破坏了不变式，显式失败而不是静默换错棒。
   */
  private advanceAfterCurrentPhase(room: RoomSecret): void {
    const relay = this.requireRelay(room)
    const step = relay.currentStep
    if (room.phase === 'relay_choose') {
      this.beginDrawStep(room, 1)
      return
    }
    if (room.phase === 'relay_draw') {
      if (!isDrawingStep(step)) throw new GameError('INTERNAL_ERROR')
      this.beginGuessStep(room, step === 1 ? 2 : 4)
      return
    }
    if (room.phase === 'relay_guess') {
      // 猜词阶段只可能是步 2/4（作画步骤出现在这里是状态损坏）
      if (isDrawingStep(step)) throw new GameError('INTERNAL_ERROR')
      if (step === 2) this.beginDrawStep(room, 3)
      else this.beginShowcase(room)
    }
  }

  /**
   * 代交调度（S7 / S8）：给链阵容里每一位「本步还没动手」的成员重算代交安排。三处调用：
   * 进入新的一棒、成员断线、成员离开/退局。规则只有一条——**代交时刻**：
   * - 已不在房间（离房 / 退局）→ 立刻（他再也不可能自己动手）；
   * - 断线中 → 断线时刻 + 短宽限（宽限内重连即由在场事实自动让路）；
   * - 在线 → 不安排（等他本人，或本步倒计时的大扫掠）。
   * 「宽限先到」与「倒计时先到」共用同一个提交集去重（`autoSubmitStep` 的幂等守卫），绝不重复代交。
   */
  public refreshAutoSubmit(room: RoomSecret, playerId: string): void {
    const relay = room.relay
    if (!relay || !isRelayPlayPhase(room.phase)) return
    if (!this.isParticipant(relay, playerId)) return
    if (relay.stepSubmissions.has(playerId)) return
    this.clearAutoSubmitTimer(relay, playerId)
    const now = this.service.clock.now()
    const deadlineMs = this.autoSubmitDeadlineMs(room, playerId, now)
    if (deadlineMs === undefined) return
    if (deadlineMs <= now) {
      this.autoSubmitStep(room, playerId, relay.stepId)
      return
    }
    this.scheduleAutoSubmit(room, relay, playerId, relay.stepId, deadlineMs - now)
  }

  /** 进入新一棒时的统一扫掠：链阵容里每位成员按在场事实决定「立即代交 / 排宽限计时器」。 */
  private scheduleStepAutoSubmits(room: RoomSecret, relay: RelayGameSecret): void {
    const stepId = relay.stepId
    for (const chain of relay.chains) {
      if (relay.stepSubmissions.has(chain.originPlayerId)) continue
      this.refreshAutoSubmit(room, chain.originPlayerId)
      // 立即代交可能让本棒提前满员（换手）：此时本步的扫掠到此为止，剩下的人在新一棒另行安排
      if (relay.stepId !== stepId) return
    }
  }

  /** 某成员本步的代交时刻（ms）；`undefined`＝不代交（在线，交回本人或本步倒计时）。 */
  private autoSubmitDeadlineMs(
    room: RoomSecret,
    playerId: string,
    now: number,
  ): number | undefined {
    // 「仍占链位但已不在房间」＝离房或被移除（退局者仍在 members 里，由 leftGame 标记）
    const member = room.members.find((candidate) => candidate.playerId === playerId)
    if (!member || member.leftGame) return now
    const presence = this.service.getPlayerPresence(playerId)
    if (presence.connected) return undefined
    return Math.max(
      now,
      (presence.disconnectedAt ?? now) + APP_CONFIG.network.drawerReconnectGraceMs,
    )
  }

  /** 排一名成员的代交计时器：到点复核在场事实，宽限已过才代交（重连 / 新代次一律让路）。 */
  private scheduleAutoSubmit(
    room: RoomSecret,
    relay: RelayGameSecret,
    playerId: string,
    stepId: string,
    delayMs: number,
  ): void {
    relay.autoSubmitTimers.set(
      playerId,
      this.service.scheduler.set(delayMs, () =>
        this.service.safeRun('relayStepAutoSubmit', () => {
          // 换手后旧计时器一律让路：新一棒的代交在进入时已另行安排
          if (relay.stepId !== stepId) return
          const now = this.service.clock.now()
          const deadlineMs = this.autoSubmitDeadlineMs(room, playerId, now)
          // 宽限内重连：本步交回本人（或本步倒计时兜底）
          if (deadlineMs === undefined) return
          // 又断了一次（新代次）：按新宽限重排，而不是提前代交
          if (deadlineMs > now) {
            this.scheduleAutoSubmit(room, relay, playerId, stepId, deadlineMs - now)
            return
          }
          this.autoSubmitStep(room, playerId, stepId)
        }),
      ),
    )
  }

  /**
   * 代交一名成员的本步（幂等）：换手或已提交一律让路，因此宽限与倒计时两条路径不会重复代交；
   * 代交补齐后若全员到齐，立即换手——少数人的网络问题绝不拖住全房（S8 / S29）。
   */
  private autoSubmitStep(room: RoomSecret, playerId: string, stepId: string): void {
    const relay = this.requireRelay(room)
    if (relay.stepId !== stepId) return
    if (relay.stepSubmissions.has(playerId)) return
    this.writeAutoSubmitProduct(relay, this.chainFor(relay, playerId, relay.currentStep))
    relay.stepSubmissions.add(playerId)
    this.advanceIfComplete(room, stepId)
  }

  /** 本步倒计时到点：仍未交的成员一律按代交口径补齐（随后由调用方换手）。 */
  private autoSubmitRemaining(relay: RelayGameSecret): void {
    for (const chain of relay.chains) {
      if (relay.stepSubmissions.has(chain.originPlayerId)) continue
      this.writeAutoSubmitProduct(relay, chain)
      relay.stepSubmissions.add(chain.originPlayerId)
    }
  }

  /**
   * 本步代交内容（唯一 seam，S16）：把「没交」的成员补成一份合法产出，链因此永不中断。
   * - 猜词步（步 2/4）：S16 要求交「当前输入框内容」，未输入才填「？」——但线上没有任何承载
   *   未提交草稿的通道（`game:canvas_ping` 只是画布微表情广播，`relay:submitGuess` 提交即锁定），
   *   服务端观测不到草稿，因此收敛为固定兜底 `RELAY_AUTO_SUBMIT_GUESS_TEXT`（「上家未作答」）；
   *   将来若接入草稿镜像，只改本函数 + 协议层，换手 / 宽限 / 离开者占位逻辑都不受影响；
   * - 作画步（步 1/3）：交**已有笔画**——画布本身就是权威历史，空画布即空白画布，无需写入；
   * - 选词步（步 1 的 `relay_choose`）：随机代选本链候选之一，绝不把空白画布交给下一棒（S40）。
   */
  private writeAutoSubmitProduct(relay: RelayGameSecret, chain: RelayChainSecret): void {
    const step = relay.currentStep
    if (step === 1) {
      // 选词与作画同在步 1：只有还没题面时才需要随机代选，作画阶段的代交＝交已有笔画（无需写入）
      if (chain.step1Word) return
      const word = chain.candidates.length
        ? chain.candidates[this.service.random.integer(chain.candidates.length)]
        : undefined
      // 候选为空说明开局词库门禁被绕过（开始一局前已校验词数）：显式失败，绝不伪造题面
      if (!word) throw new GameError('INTERNAL_ERROR')
      chain.step1Word = word
      chain.offeredWordIds.add(word.id)
      return
    }
    if (step === 2) chain.step2Guess = RELAY_AUTO_SUBMIT_GUESS_TEXT
    if (step === 4) chain.step4Guess = RELAY_AUTO_SUBMIT_GUESS_TEXT
  }

  /** 写本链题面并计入本步已提交（权威记录挂接龙结构，S64）。 */
  private commitChainWord(
    relay: RelayGameSecret,
    chain: RelayChainSecret,
    word: VocabularyWord,
  ): void {
    chain.step1Word = word
    chain.offeredWordIds.add(word.id)
    relay.stepSubmissions.add(chain.originPlayerId)
  }

  /** 把一句猜词写进该链的对应半场（步 2 → 第一半场、步 4 → 第二半场）。 */
  private writeGuess(chain: RelayChainSecret, step: RelayGuessingStep, text: string): void {
    if (step === 2) chain.step2Guess = text
    else chain.step4Guess = text
  }

  /** 观看者本棒的链（S9 的环状顺延唯一算式在 `relayChainIndexOf`，与画布解析 / 视图共用）。 */
  private chainFor(relay: RelayGameSecret, playerId: string, step: RelayStep): RelayChainSecret {
    const originIndex = relay.chains.findIndex((chain) => chain.originPlayerId === playerId)
    if (originIndex < 0) throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER)
    const chain = relay.chains[relayChainIndexOf(relay.chains.length, originIndex, step)]
    if (!chain) throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER)
    return chain
  }

  /**
   * 选词上下文守卫：步骤 id → 阶段 → 到期 → 本链归属 → 重复提交（顺序即优先级）。
   * 旧包（步骤 id 不符）最先，客户端据此重新同步步骤与候选。
   */
  private requireChoosingChain(
    room: RoomSecret,
    playerId: string,
    stepId: string,
  ): { relay: RelayGameSecret; chain: RelayChainSecret } {
    const relay = this.requireRelay(room)
    if (stepId !== relay.stepId)
      throw new GameError('STALE_DRAW_EVENT', serverStrings.errors.STALE_DRAW_EVENT_STROKE)
    if (room.phase !== 'relay_choose')
      throw new GameError('INVALID_PHASE', serverStrings.errors.NOT_DRAWER_CHOOSE)
    if (isPhaseExpired(relay, this.service.clock.now()))
      throw new GameError('PHASE_EXPIRED', serverStrings.errors.PHASE_EXPIRED)
    const chain = relay.chains.find((candidate) => candidate.originPlayerId === playerId)
    if (!chain) throw new GameError('NOT_DRAWER', serverStrings.errors.NOT_DRAWER)
    if (relay.stepSubmissions.has(playerId)) throw new GameError('ALREADY_SUBMITTED')
    return { relay, chain }
  }

  /**
   * 自定义词撞词判定：与本链已展示过的词或当前候选（规范化后）相同即视为重复，
   * 与经典的撞词口径一致（只是把去重范围收到本链，S31）。
   */
  private isDuplicateInChain(room: RoomSecret, chain: RelayChainSecret, text: string): boolean {
    const normalized = normalizeAnswer(text)
    const store = this.service.getRoomVocabularyStore(room)
    for (const id of chain.offeredWordIds) {
      const word = store.byId.get(id)
      if (word && normalizeAnswer(word.text) === normalized) return true
    }
    return chain.candidates.some((candidate) => normalizeAnswer(candidate.text) === normalized)
  }

  /**
   * 抽取一条链的候选词：词池＝房间本局选中的词条，按链排除本链已展示过的词条
   *（S31：候选**不跨链去重**，各链独立抽 `optionCount` 个）。
   * 词池不足且配置允许重置时清空本链记录再抽，与经典 `pickCandidates` 同一兜底口径。
   */
  private pickCandidates(room: RoomSecret, chain: RelayChainSecret): VocabularyWord[] {
    const store = this.service.getRoomVocabularyStore(room)
    const poolOf = (excluded: Set<string>): VocabularyWord[] =>
      [...room.selectedWordIds]
        .filter((id) => !excluded.has(id))
        .map((id) => store.byId.get(id))
        .filter((word): word is VocabularyWord => word !== undefined)
    let pool = poolOf(chain.offeredWordIds)
    if (pool.length < room.settings.optionCount && APP_CONFIG.vocabulary.resetWhenExhausted) {
      chain.offeredWordIds.clear()
      pool = poolOf(chain.offeredWordIds)
    }
    // 先洗牌再按分类多样性抽样：分类均匀与顺序随机兼顾（与经典同一口径）
    const selected = selectDiverseCandidates({
      pool: this.shuffle(pool),
      count: room.settings.optionCount,
    })
    const picked = pool.length <= room.settings.optionCount ? selected : this.shuffle(selected)
    picked.forEach((word) => chain.offeredWordIds.add(word.id))
    return picked
  }

  /** Fisher-Yates 洗牌：随机打乱数组并返回新数组（随机源统一走运行时，禁止 Math.random）。 */
  private shuffle<T>(values: T[]): T[] {
    const result = [...values]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = this.service.random.integer(index + 1)
      ;[result[index], result[target]] = [result[target] as T, result[index] as T]
    }
    return result
  }

  /**
   * 全员到齐判定：本棒每位动手者都已提交。
   * 每个步骤全员各动手一次（S9），因此「链阵容全员」＝「本棒动手者全集」，判定与步号无关；
   * 链与开局玩家一一对应，所以只需检查链发起人集合即可。
   */
  private allSubmitted(relay: RelayGameSecret): boolean {
    return relay.chains.every((chain) => relay.stepSubmissions.has(chain.originPlayerId))
  }

  /** 是否本局链阵容中的成员（残留连接不占链位，一律拒绝）。 */
  private isParticipant(relay: RelayGameSecret, playerId: string): boolean {
    return relay.chains.some((chain) => chain.originPlayerId === playerId)
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
   * 规则变更后清空全员准备位并广播通知（与经典同一口径）。
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

  /** 追加一条聊天 / 通知消息并裁剪队列（与经典 `addMessage` 同一队列上限口径）。 */
  public addMessage(room: RoomSecret, input: Omit<ChatMessage, 'id' | 'createdAt'>): void {
    const relay = this.requireRelay(room)
    relay.messages.push({
      ...input,
      id: this.service.random.uuid(),
      createdAt: this.service.clock.now(),
    })
    // 队列上限为快照下发条数的 2 倍：多出一倍作为缓冲，保证快照 slice(-N) 总能取满
    relay.messages = relay.messages.slice(-APP_CONFIG.ui.recentMessageCount * 2)
  }

  /** 系统通知：写入房间聊天流（S79 的社交频道）并作为独立事件推送。 */
  public addSystemNotice(room: RoomSecret, text: string): void {
    if (room.relay) this.addMessage(room, { type: 'system', text })
    this.service.emitSystemNotice(room.id, text)
  }

  /**
   * 废弃当前接龙局：清掉主计时器与接龙秘密（房间回到等待时调用）。
   * 开局倒计时被取消（成员离房）就走这条路径——经典的 `setWaiting` 只清理 `room.game`，
   * 接龙秘密必须由接龙状态机自己清，否则等待中的房间会留着一份已作废的接龙局。
   */
  public discard(room: RoomSecret): void {
    if (!room.relay) return
    this.clearStepTimers(room.relay)
    // 结算期的两个时限计时器一并回收：否则等待中的房间会被旧的「自动返回」回调再清一次场
    this.service.scheduler.clear(room.relay.rematchTimer)
    room.relay.rematchTimer = undefined
    delete room.relay
  }

  /** 清理本步的全部计时器：主阶段计时器 + 代交计时器（换手、开局与作废接龙局共用）。 */
  private clearStepTimers(relay: RelayGameSecret | undefined): void {
    if (!relay) return
    this.service.scheduler.clear(relay.timer)
    relay.timer = undefined
    this.clearAutoSubmitTimers(relay)
  }

  /** 清理单名成员的代交计时器：重算安排前先撤掉旧句柄，避免同一成员挂两个代交。 */
  private clearAutoSubmitTimer(relay: RelayGameSecret, playerId: string): void {
    const timer = relay.autoSubmitTimers.get(playerId)
    if (timer === undefined) return
    this.service.scheduler.clear(timer)
    relay.autoSubmitTimers.delete(playerId)
  }

  /** 清理全部代交计时器（换手时整体失效：回调自身还有步 id 守卫，双重防线）。 */
  private clearAutoSubmitTimers(relay: RelayGameSecret): void {
    for (const timer of relay.autoSubmitTimers.values()) this.service.scheduler.clear(timer)
    relay.autoSubmitTimers.clear()
  }

  /** 取接龙局秘密；房间没有进行中的接龙局时抛 NO_GAME（端口实现见装配层）。 */
  private requireRelay(room: RoomSecret): RelayGameSecret {
    return this.service.requireRelay(room)
  }
}
