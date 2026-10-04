/**
 * 接龙测试装配件（工单 04 起，工单 05 补齐装配缝）。
 *
 * 全仓库只此一个接龙测试缝，复用既有的假时钟、内存仓储、迷你词库与测试 Socket：
 * - `startRelayGame`（推荐）：一次调用得到「N 人接龙房 + 词库 + 已开局」，落在**步 1 选词**幕；
 *   建房、玩家就位、准备与开局门禁全部走真实服务路径，并用 `chooseAll` / `submitAllDrawings`
 *   沿真实事件路径继续推进幕次。全部接龙服务端用例都应从它出发。
 * - `startRelayDrawing`（工单 04 的最小构造）：只为画布通路用例直接组装「某个作画步骤的本棒」，
 *   用于覆盖真实门禁到不了的格（越权成员、任意步骤 / 阶段的错配）。
 * 全部字段都由生产模型与配置常量组装，生产代码里没有任何配套的测试后门。
 */
import {
  EVENTS,
  PLAYER_PROTOCOL_LIMITS,
  RELAY_MIN_PLAYERS,
  SERVER_PUSH_SCHEMAS,
  type ErrorCode,
  type RelayStep,
  type RoomPhase,
  type RoomSettings,
  type RoomSnapshot,
} from '@draw-guess/shared'
import { APP_CONFIG } from '../../../apps/server/src/config/index.ts'
import { GameError } from '../../../apps/server/src/errors.ts'
import type { DrawingCanvasState } from '../../../apps/server/src/domain/drawing/drawing-core.ts'
import {
  createRelayChainSecret,
  type RelayChainSecret,
  type RelayGameSecret,
} from '../../../apps/server/src/domain/relay/relay-models.ts'
import type {
  RelayDrawingStep,
  RelayGuessingStep,
} from '../../../apps/server/src/domain/relay/relay-steps.ts'
import {
  RELAY_SHOWCASE_PAGES,
  showcasePageMs,
  type RelayShowcaseCursor,
} from '../../../apps/server/src/domain/relay/relay-showcase.ts'
import type { RoomSecret } from '../../../apps/server/src/models.ts'
import {
  createGameHarness,
  testRoomSettings,
  type GameHarness,
  type TestSocket,
} from './game-harness.ts'

/**
 * 捕获业务错误码：客户端按码分支，因此用例断言「拒绝的码」而不只看文案；
 * 与装配件同处一个测试缝，接龙的拒绝路径用例共用一个 try/catch，不各写一份。
 */
export function errorCodeOf(run: () => unknown): ErrorCode {
  try {
    run()
  } catch (error) {
    if (error instanceof GameError) return error.code
    throw error
  }
  throw new Error('期望请求被拒绝，但没有抛出错误')
}

/** 接龙测试玩家：身份 + 测试连接（用于断言「谁收到了推送」）。 */
export interface RelayTestPlayer {
  playerId: string
  nickname: string
  socket: TestSocket
  /** 身份恢复令牌：断线重连用例凭它走真实恢复路径，拿回同一身份与链位。 */
  recoveryToken: string
}

/** 接龙画布通路用例的场景：4～6 人接龙房 + 已就位的链数组 + 当前作画步骤。 */
export interface RelayDrawingScenario {
  harness: GameHarness
  room: RoomSecret
  relay: RelayGameSecret
  players: RelayTestPlayer[]
  /** 在房里但没有分到链的成员（越权用例）：他们不在本局链阵容中，作画必须被拒。 */
  unseated: RelayTestPlayer[]
  /** 当前步骤号（1～4，读接龙局的权威字段）。 */
  readonly step: RelayStep
  /** 当前步骤的全局 id（该步所有玩家共用，S53）。 */
  readonly stepId: string
  /**
   * 取「某玩家在某作画步骤负责的那幅画布」：
   * 链 j 的第 s 棒作画者是链 (j + s - 1) 的发起人（环状顺延，S9），
   * 因此玩家本棒的链是「以他为发起人的链」向前回退 (s - 1) 条。
   * 这里的算式是测试侧的独立口径，与被测解析函数互为参照（见 relay-canvas-target 用例的手算样例）。
   */
  canvasOf(playerId: string, step: RelayDrawingStep): DrawingCanvasState
  /** 测试专用推进：把本局切到指定步骤与阶段（步骤 id 换新、阶段时间重新起算，链与画布不动）。 */
  moveTo(input: { step: RelayStep; phase: RoomPhase }): void
}

export function startRelayDrawing(
  options: {
    harness?: GameHarness
    /** 房间人数（≥ 接龙开局下限且 ≤ 协议容量上限），每个成员都是自己那条链的发起人。 */
    playerCount?: number
    /**
     * 额外进房但**不参与本局链**的成员数（越权用例专用）。
     * 开局门禁会拦住中途入座（S36），所以这些成员在接龙局建立之前就进房；
     * 他们模拟「残留连接 / 不在本局链阵容中」的请求者，服务端必须拒绝其作画。
     */
    unseatedCount?: number
    /** 初始作画步骤（默认步 1）。 */
    step?: RelayDrawingStep
  } = {},
): RelayDrawingScenario {
  const harness = options.harness ?? createGameHarness()
  const playerCount = options.playerCount ?? RELAY_MIN_PLAYERS
  const initialStep = options.step ?? 1
  if (playerCount < RELAY_MIN_PLAYERS) throw new Error('接龙测试房至少需要 4 名玩家')

  const registrations = Array.from(
    { length: playerCount + (options.unseatedCount ?? 0) },
    (_, index) => {
      const nickname = index === 0 ? '接龙房主' : `接龙玩家${index + 1}`
      return { nickname, ...harness.register(nickname) }
    },
  )
  const allMembers: RelayTestPlayer[] = registrations.map((registration) => ({
    playerId: registration.playerId,
    nickname: registration.nickname,
    socket: registration.socket,
    recoveryToken: registration.recoveryToken,
  }))
  // 分到链的成员（前 playerCount 名）与未分到链的成员（越权用例）。
  const players = allMembers.slice(0, playerCount)
  const unseated = allMembers.slice(playerCount)
  const host = players[0]
  if (!host) throw new Error('接龙测试房缺少房主')

  // 接龙房：模式在建房时确定（S27 / S28）；容量与规则沿用共享协议口径。
  const created = harness.service.createRoom(host.playerId, {
    name: '接龙测试房间',
    visibility: 'public',
    gameMode: 'relay',
    settings: testRoomSettings(),
  })
  for (const player of [...players.slice(1), ...unseated])
    harness.service.joinRoom(player.playerId, created.id)
  const room = harness.service.rooms.get(created.id)
  if (!room) throw new Error('接龙测试房间未创建')

  // 链顺序 = 席位顺序（S11）：每个成员都是自己那条链的发起人，环状顺延由步骤解析负责。
  const relay: RelayGameSecret = {
    id: harness.runtime.random.uuid(),
    startedAt: harness.runtime.now(),
    currentStep: initialStep,
    stepId: harness.runtime.random.uuid(),
    phaseStartedAt: harness.runtime.now(),
    // 截止时间取够长的作画时长：阶段时长的权威口径归工单 05，这里只保证不误触 PHASE_EXPIRED。
    phaseEndsAt: harness.runtime.now() + APP_CONFIG.relay.drawSeconds.default * 1_000,
    chains: players.map((player) => createRelayChainSecret(player.playerId)),
    stepSubmissions: new Set<string>(),
    autoSubmitTimers: new Map(),
    messages: [],
  }
  room.phase = 'relay_draw'
  room.relay = relay

  return {
    harness,
    room,
    relay,
    players,
    unseated,
    get step() {
      return relay.currentStep
    },
    get stepId() {
      return relay.stepId
    },
    canvasOf: (playerId, step) => {
      const originIndex = relay.chains.findIndex((chain) => chain.originPlayerId === playerId)
      if (originIndex < 0) throw new Error(`玩家 ${playerId} 不在本局链阵容中`)
      const chain =
        relay.chains[(originIndex - (step - 1) + relay.chains.length) % relay.chains.length]
      if (!chain) throw new Error('接龙局的链数组为空')
      return step === 1 ? chain.step1Canvas : chain.step3Canvas
    },
    moveTo: ({ step, phase }) => {
      relay.currentStep = step
      relay.stepId = harness.runtime.random.uuid()
      relay.phaseStartedAt = harness.runtime.now()
      relay.phaseEndsAt = harness.runtime.now() + APP_CONFIG.relay.drawSeconds.default * 1_000
      room.phase = phase
    },
  }
}

/** 接龙装配缝场景：4～6 人接龙房 + 内存词库 + 已开局（工单 05 起全部接龙服务端用例的起点）。 */
export interface RelayGameScenario {
  harness: GameHarness
  room: RoomSecret
  relay: RelayGameSecret
  host: RelayTestPlayer
  /** 开局玩家（链阵容，按席位顺序：players[i] 是链 i 的发起人）。 */
  players: RelayTestPlayer[]
  /** 当前步骤号（读接龙局的权威字段）。 */
  readonly step: RelayStep
  /** 当前步骤的全局 id（该步所有玩家共用，S53）。 */
  readonly stepId: string
  /** 观看者的房间快照：走真实裁剪路径（快照里的 relay 视图即线上载荷）。 */
  snapshotOf(playerId: string): RoomSnapshot
  /** 全部 systemNotice 文案（按协议解码后取正文），用于断言 S65 的关键节点通知。 */
  notices(): string[]
  /**
   * 某玩家在某步骤负责的链（默认当前步）。
   * 算式是测试侧的独立口径：链 j 的第 s 棒动手者是链 (j + s - 1) 的发起人（S9），
   * 因此玩家本棒的链＝以他为发起人的链向前回退 (s - 1) 条；与被测实现互为参照。
   */
  chainOf(playerId: string, step?: RelayStep): RelayChainSecret
  /** 取某玩家在某作画步骤负责的画布（步 1 → 第一幅，步 3 → 第二幅）。 */
  canvasOf(playerId: string, step: RelayDrawingStep): DrawingCanvasState
  /** 取某玩家在某猜词步负责的链上写着的答案（步 2 → `step2Guess`，步 4 → `step4Guess`）。 */
  guessOf(playerId: string, step: RelayGuessingStep): string | undefined
  /** 全员各选自己候选里的第一个词（真实 `game:chooseWord` 路径）：选满即秒切作画。 */
  chooseAll(): void
  /** 全员提交本棒作画（真实 `relay:submitDrawing` 路径）：提交满即结算并进入下一棒。 */
  submitAllDrawings(): void
  /**
   * 全员各提交一句本棒猜词（真实 `relay:submitGuess` 路径）；返回「玩家 ID → 提交的文本」。
   * 默认文本为 `答案-<昵称>`；用例可传入自定义文本（如断言链上写着谁的那句）。
   */
  submitAllGuesses(textOf?: (player: RelayTestPlayer) => string): Map<string, string>
  /** 断线（真实断线编排）：接龙对局阶段保留席位，并按短宽限安排本步代交（S8）。 */
  disconnect(player: RelayTestPlayer): void
  /** 断线重连（真实身份恢复路径）：宽限内重连可续接当前步，返回接管后的新连接。 */
  reconnect(player: RelayTestPlayer): RelayTestPlayer
  /** 四个步骤各全员动手一次走完，停在复盘入口（步 4 结算后的 `relay_showcase` 第 1 条链重播页）。 */
  playToShowcase(): void
  /** 复盘游标（服务端权威的链序号 / 半场 / 页）：不在复盘轮播中时为 undefined。 */
  showcaseCursor(): RelayShowcaseCursor | undefined
  /** 复盘推进一页（按当前页的配置时长走假时钟），返回推进后的游标；离开展示期后返回投票期的保留游标。 */
  advanceShowcasePage(): RelayShowcaseCursor | undefined
  /** 走完当前链的两个半场（6 页），停在等待该链投票的 `relay_vote`；返回依次经过的页游标。 */
  finishShowcaseChain(): RelayShowcaseCursor[]
}

/**
 * 接龙装配件：一次调用得到「4 人接龙房 + 词库 + 已开局」，落在**步 1 选词**幕。
 * 建房（模式分支）、玩家就位、开局门禁全部走真实服务路径，测试不再各写一遍。
 * 后续幕用 `chooseAll` / `submitAllDrawings` 继续推进（步 2–4 的推进由工单 06 补齐）。
 */
export function startRelayGame(
  options: {
    harness?: GameHarness
    /** 开局人数（≥ 接龙下限且 ≤ 协议容量上限）。 */
    playerCount?: number
    /** 房间规则覆盖（接龙时长 / 候选数 / 换批与自定义词开关等）。 */
    settings?: Partial<RoomSettings>
  } = {},
): RelayGameScenario {
  const harness = options.harness ?? createGameHarness()
  const playerCount = options.playerCount ?? RELAY_MIN_PLAYERS
  if (playerCount < RELAY_MIN_PLAYERS || playerCount > PLAYER_PROTOCOL_LIMITS.maxPlayers)
    throw new Error('接龙测试房人数必须在开局下限与容量上限之间')

  const registrations = Array.from({ length: playerCount }, (_, index) => {
    const nickname = index === 0 ? '接龙房主' : `接龙玩家${index + 1}`
    return { nickname, ...harness.register(nickname) }
  })
  const players: RelayTestPlayer[] = registrations.map((registration) => ({
    playerId: registration.playerId,
    nickname: registration.nickname,
    socket: registration.socket,
    recoveryToken: registration.recoveryToken,
  }))
  const host = players[0]
  if (!host) throw new Error('接龙测试房缺少房主')

  // 接龙房：模式在建房时确定（S27 / S28），容量与规则沿用共享协议口径。
  const created = harness.service.createRoom(host.playerId, {
    name: '接龙测试房间',
    visibility: 'public',
    gameMode: 'relay',
    settings: testRoomSettings(options.settings),
  })
  let latest = created
  for (const player of players.slice(1)) {
    harness.service.joinRoom(player.playerId, created.id)
    // 接龙门禁沿用经典准备口径：非房主成员必须显式准备（S62）
    latest = harness.service.setReady(player.playerId, true)
  }
  harness.service.startGame(host.playerId, latest.stateVersion)
  const room = harness.service.rooms.get(created.id)
  if (!room) throw new Error('接龙测试房间未创建')
  // 开局倒计时（复用经典 starting 阶段，S22）到期后进入步 1 选词
  harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)
  const relay = room.relay
  if (!relay) throw new Error('接龙局未启动')

  const chainOf = (playerId: string, step: RelayStep = relay.currentStep): RelayChainSecret => {
    const originIndex = relay.chains.findIndex((chain) => chain.originPlayerId === playerId)
    if (originIndex < 0) throw new Error(`玩家 ${playerId} 不在本局链阵容中`)
    const chain =
      relay.chains[(originIndex - (step - 1) + relay.chains.length) % relay.chains.length]
    if (!chain) throw new Error('接龙局的链数组为空')
    return chain
  }

  /**
   * 本棒还能不能「替他提交」：只有在线、在席（未离局）、且本棒未提交的成员才由用例驱动。
   * 离房（不在成员数组）与退局（leftGame）的成员不再是请求主体；掉线者的棒次由服务端按宽限代交——
   * 三类都由服务端兜底，用例既不必也不能代替他们提交。
   */
  const stillCanAct = (player: RelayTestPlayer): boolean =>
    harness.service.players.get(player.playerId)?.connected === true &&
    room.members.some((member) => member.playerId === player.playerId && !member.leftGame) &&
    !relay.stepSubmissions.has(player.playerId)

  const chooseAll = (): void => {
    for (const player of players) {
      if (!stillCanAct(player)) continue
      const chain = chainOf(player.playerId, 1)
      const word = chain.candidates[0]
      if (!word) throw new Error('步 1 选词候选为空')
      harness.service.chooseWord(player.playerId, relay.stepId, word.id)
    }
  }

  const submitAllDrawings = (): void => {
    for (const player of players) {
      if (!stillCanAct(player)) continue
      harness.service.submitRelayDrawing(player.playerId, relay.stepId)
    }
  }

  const submitAllGuesses = (
    textOf: (player: RelayTestPlayer) => string = (player) => `答案-${player.nickname}`,
  ): Map<string, string> => {
    if (room.phase !== 'relay_guess') throw new Error('只有在猜词棒才能提交答案')
    const submitted = new Map<string, string>()
    for (const player of players) {
      if (!stillCanAct(player)) continue
      const text = textOf(player)
      harness.service.submitRelayGuess(player.playerId, relay.stepId, text)
      submitted.set(player.playerId, text)
    }
    return submitted
  }

  /** 四个步骤各全员动手一次走完，停在复盘入口（步 4 结算后的 `relay_showcase` 第 1 条链重播页）。 */
  const playToShowcase = (): void => {
    chooseAll()
    submitAllDrawings()
    submitAllGuesses()
    submitAllDrawings()
    submitAllGuesses()
  }

  return {
    harness,
    room,
    relay,
    host,
    players,
    get step() {
      return relay.currentStep
    },
    get stepId() {
      return relay.stepId
    },
    snapshotOf: (playerId) => {
      const snapshot = harness.service.snapshotForPlayer(playerId)
      if (!snapshot) throw new Error(`玩家 ${playerId} 没有房间快照`)
      return snapshot
    },
    notices: () => {
      const schema = SERVER_PUSH_SCHEMAS[EVENTS.systemNotice]
      return harness.ioEvents
        .filter((record) => record.event === EVENTS.systemNotice)
        .map((record) => {
          const parsed = schema.safeParse(record.payload)
          if (!parsed.success) throw new Error('systemNotice 推送未通过协议校验')
          return parsed.data.data.text
        })
    },
    chainOf,
    canvasOf: (playerId, step) => {
      const chain = chainOf(playerId, step)
      return step === 1 ? chain.step1Canvas : chain.step3Canvas
    },
    guessOf: (playerId, step) => {
      const chain = chainOf(playerId, step)
      return step === 2 ? chain.step2Guess : chain.step4Guess
    },
    chooseAll,
    submitAllDrawings,
    submitAllGuesses,
    playToShowcase,
    showcaseCursor: () => room.relay?.showcase,
    advanceShowcasePage: () => {
      const cursor = room.relay?.showcase
      if (!cursor) throw new Error('当前不在复盘轮播中')
      harness.runtime.advance(showcasePageMs(cursor.page))
      return room.relay?.showcase
    },
    finishShowcaseChain: () => {
      const seen: RelayShowcaseCursor[] = []
      // 一条链固定 6 页（两个半场 × 三页，S43）：页数即循环上界，走不动时显式失败而不是空转
      const pageLimit = RELAY_SHOWCASE_PAGES.length * 2
      while (room.phase === 'relay_showcase') {
        const cursor = room.relay?.showcase
        if (!cursor) throw new Error('复盘轮播缺少游标')
        if (seen.length >= pageLimit) throw new Error('复盘轮播未在两个半场（6 页）内走完')
        seen.push(cursor)
        harness.runtime.advance(showcasePageMs(cursor.page))
      }
      return seen
    },
    disconnect: (player) => {
      // 走真实断线编排：接龙对局阶段保席 + 短宽限代交，与「掉线者不入链」的经典口径分开
      harness.service.handleDisconnect(player.socket as never)
    },
    reconnect: (player) => {
      const registration = harness.register(player.nickname, undefined, player.recoveryToken)
      player.socket = registration.socket
      return player
    },
  }
}
