/**
 * 接龙生命周期状态机（S55）：与经典 `RoundMachine` **平级**，只依赖窄端口
 *（`RelayContext`，与 `RoundContext` 同一哲学——不反向依赖整机服务）。
 *
 * 本单覆盖「开局 → 步 1 选词 → 步 1 作画 → 进入步 2」：
 * - 开局：链数组按席位顺序建立（S11）、N 条链 = N 名开局玩家（S9），随后复用 `starting` 倒计时（S22）；
 * - 选词：全员同时从**自己那条链**的候选里挑（S31 / S35），可换一批、可自定义题目（S50）；
 *   全员选完**秒切**作画，倒计时结束仍未选的人由服务端**随机代选**（S40，绝不出现空白画布）；
 * - 作画：每人在自己链的第一幅画布上动手（目标解析见 `relay-canvas-target`，命令写入由工单 04 的通路完成），
 *   全员提交（`relay:submitDrawing`）或倒计时到即结算并进入步 2（S65 的关键节点通知）。
 *
 * 阶段写入、准备失效、对局消息与计时器全部归本状态机所有，与经典的职责分工一致
 *（见 docs/adr/0024-round-machine-ownership.md）。步 2–4 的猜词 / 作画与掉队代交归工单 06。
 */
import { APP_CONFIG } from '../../config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import {
  canTransition,
  normalizeAnswer,
  type ChatMessage,
  type RoomPhase,
  type VocabularyWord,
} from '@draw-guess/shared'
import type { MemberState, RoomSecret } from '../../models.ts'
import { GameError, type RuntimeLogger } from '../../errors.ts'
import type { RuntimeDependencies } from '../../runtime.ts'
import type { VocabularyStore } from '../../vocabulary/index.ts'
import { selectDiverseCandidates } from '../vocabulary/candidate-selector.ts'
import { createEmptyMemberStats, isPhaseExpired } from '../room/member-facts.ts'
import {
  createRelayChainSecret,
  type RelayChainSecret,
  type RelayGameSecret,
} from './relay-models.ts'
import type { RelayGuessingStep } from './relay-steps.ts'

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
  /** 推送 systemNotice 事件（系统通知的唯一传输出口）。 */
  emitSystemNotice(roomId: string, text: string): void
  emitRoom(roomId: string): void
  broadcastPresence(): void
  safeRun(label: string, action: () => void): void
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
    this.stopTimer(room.relay)
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
    this.stopTimer(relay)
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
    relay.timer = this.service.scheduler.set(chooseMs, () =>
      this.service.safeRun('relayChooseTimeout', () => this.autoChooseWords(room)),
    )
    // 关键节点通知：开局（S65）
    this.addSystemNotice(room, serverStrings.notices.relayStarted)
    this.service.emitRoom(room.id)
  }

  /**
   * 步 1 选词：把观看者本链的候选之一写成本链题面。
   * 该玩家随即计入「已提交」——全员选完由 `maybeBeginDrawing` 秒切作画（S40）。
   */
  public chooseWord(room: RoomSecret, playerId: string, stepId: string, wordId: string): void {
    const { relay, chain } = this.requireChoosingChain(room, playerId, stepId)
    const word = chain.candidates.find((candidate) => candidate.id === wordId)
    if (!word) throw new GameError('INVALID_WORD_ID', serverStrings.errors.INVALID_WORD_ID_CHOOSE)
    this.commitChainWord(relay, chain, word)
    this.maybeBeginDrawing(room)
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
    this.maybeBeginDrawing(room)
  }

  /**
   * 步 1 作画：每人只在自己那条链的第一幅画布上动手，题面就是自己选的词。
   * 全员提交（`relay:submitDrawing`）或倒计时到即结算并进入步 2。
   */
  public beginDrawing(room: RoomSecret): void {
    const relay = this.requireRelay(room)
    this.stopTimer(relay)
    this.transition(room, 'relay_draw')
    // 选词阶段的「已提交」到此清场：本棒的提交集只统计作画完成（S64 的本步已提交集）
    relay.stepSubmissions.clear()
    const drawMs = room.settings.relayDrawSeconds * 1_000
    relay.phaseStartedAt = this.service.clock.now()
    relay.phaseEndsAt = relay.phaseStartedAt + drawMs
    relay.timer = this.service.scheduler.set(drawMs, () =>
      this.service.safeRun('relayDrawingTimeout', () => this.finishStepOne(room)),
    )
    this.service.emitRoom(room.id)
  }

  /**
   * 提交本棒作画（`relay:submitDrawing`，S30）：只标记完成并锁定，交的是已有笔画。
   * 全员提交即取消剩余倒计时并结算本步（秒切下一棒）。
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
    if (this.allSubmitted(relay)) this.finishStepOne(room)
    else this.service.emitRoom(room.id)
  }

  /** 玩家自由聊天（`chat:say`，S79）：聊天与作答彻底分离，永远不把作答带出去（S20）。 */
  public chat(room: RoomSecret, playerId: string, text: string): void {
    this.requireRelay(room)
    this.addMessage(room, { type: 'guess', text, playerId })
    this.service.emitRoom(room.id)
  }

  /**
   * 步骤结算与换手：步 1 全员完成（或倒计时到）后取消剩余倒计时并进入步 2。
   * 步 2–4 的猜词 / 作画、超时代交与向后再推进归工单 06，因此这里只推进到「步骤 2 的现场」。
   */
  private finishStepOne(room: RoomSecret): void {
    const relay = room.relay
    if (!relay || room.phase !== 'relay_draw') return
    this.beginGuessStep(room, 2)
  }

  /**
   * 进入猜词棒（步 2/4）：生成**新步 id**、重置本步提交集、写阶段与阶段时间，并播关键节点通知（S65）。
   * 猜词提交与超时推进归工单 06：本单只负责「进入步骤 2」的现场，不在此排计时器。
   */
  private beginGuessStep(room: RoomSecret, step: RelayGuessingStep): void {
    const relay = this.requireRelay(room)
    this.stopTimer(relay)
    relay.currentStep = step
    relay.stepId = this.service.random.uuid()
    relay.stepSubmissions.clear()
    this.transition(room, 'relay_guess')
    const guessMs = room.settings.relayGuessSeconds * 1_000
    relay.phaseStartedAt = this.service.clock.now()
    relay.phaseEndsAt = relay.phaseStartedAt + guessMs
    this.addSystemNotice(room, serverStrings.notices.relayStepStarted(step))
    this.service.emitRoom(room.id)
  }

  /**
   * 选词超时兜底：仍未选词的人由服务端**随机代选**自己候选里的一个（S40）——
   * 绝不把空白画布交给下一棒。代选与手动选词走同一提交点，因此快照与后续交接完全一致。
   */
  private autoChooseWords(room: RoomSecret): void {
    if (room.phase !== 'relay_choose') return
    const relay = this.requireRelay(room)
    for (const chain of relay.chains) {
      if (chain.step1Word) continue
      const word = chain.candidates.length
        ? chain.candidates[this.service.random.integer(chain.candidates.length)]
        : undefined
      // 候选为空说明开局词库门禁被绕过（开始一局前已校验词数）：显式失败，绝不伪造题面
      if (!word) throw new GameError('INTERNAL_ERROR')
      this.commitChainWord(relay, chain, word)
    }
    this.beginDrawing(room)
  }

  /** 全员选完即**秒切**作画（S40）：取消剩余倒计时，直接进入步 1 作画。 */
  private maybeBeginDrawing(room: RoomSecret): void {
    const relay = this.requireRelay(room)
    if (relay.chains.some((chain) => !chain.step1Word)) {
      this.service.emitRoom(room.id)
      return
    }
    this.beginDrawing(room)
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

  /** 全员完成判定：每条链的发起人都已提交（链与开局玩家一一对应，S9）。 */
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
    this.stopTimer(room.relay)
    delete room.relay
  }

  /** 清理主阶段计时器并清空引用（猜词棒由工单 06 接管，本单进入步 2 时保持无计时器）。 */
  private stopTimer(relay: RelayGameSecret | undefined): void {
    if (!relay) return
    this.service.scheduler.clear(relay.timer)
    relay.timer = undefined
  }

  /** 取接龙局秘密；房间没有进行中的接龙局时抛 NO_GAME（端口实现见装配层）。 */
  private requireRelay(room: RoomSecret): RelayGameSecret {
    return this.service.requireRelay(room)
  }
}
