/**
 * 测试用的接龙状态构造（工单 04）。
 *
 * 工单 04 只交付「接龙画布写入通路」，开局 / 选词 / 步骤推进归工单 05——因此这里不调用
 * `startGame`，而是按接龙秘密模型（`domain/relay/relay-models.ts`）把房间直接组装到
 * 「某个作画步骤的本棒」：链数组按席位顺序建立、两幅画布为空、当前步骤 id 为全局单值。
 * 全部字段都由生产模型与配置常量组装，生产代码里没有任何配套的测试后门；
 * 工单 05 的接龙装配缝落地后，本文件只保留画布通路用例需要的最小构造。
 */
import { RELAY_MIN_PLAYERS, type RelayStep, type RoomPhase } from '@draw-guess/shared'
import { APP_CONFIG } from '../../../apps/server/src/config/index.ts'
import type { DrawingCanvasState } from '../../../apps/server/src/domain/drawing/drawing-core.ts'
import {
  createRelayChainSecret,
  type RelayGameSecret,
} from '../../../apps/server/src/domain/relay/relay-models.ts'
import type { RelayDrawingStep } from '../../../apps/server/src/domain/relay/relay-steps.ts'
import type { RoomSecret } from '../../../apps/server/src/models.ts'
import {
  createGameHarness,
  testRoomSettings,
  type GameHarness,
  type TestSocket,
} from './game-harness.ts'

/** 接龙测试玩家：身份 + 测试连接（用于断言「谁收到了推送」）。 */
export interface RelayTestPlayer {
  playerId: string
  nickname: string
  socket: TestSocket
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
