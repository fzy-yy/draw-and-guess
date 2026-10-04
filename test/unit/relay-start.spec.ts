/**
 * 接龙开局门禁与开局现场（S9 / S11 / S22 / S62 / S63）。
 *
 * 断言口径（只用外部可观察行为）：
 * - 开局门禁按「在线且可玩」计数：不足 4 人或未全员准备一律以既有错误码拒绝；
 * - 开局成功后链数组 = 开局人数、按席位顺序建立（players[i] 是链 i 的发起人）；
 * - 步 1 选词的候选**按链隔离**：每人只在自己的快照里看到自己那条链的候选（S31 / S35），
 *   别人的候选词一个都不出现；
 * - 步 1 的全局步 id 只有一个（选词与作画共用，S53），阶段时间按房间规则（relayChooseSeconds）计算。
 * 期望值全部来自协议常量、配置默认值与手算样例，不用被测实现复算。
 */
import { describe, expect, it } from 'vitest'
import {
  ERROR_CODES,
  RELAY_MIN_PLAYERS,
  RELAY_STEP_COUNT,
  type RoomSettings,
  type RoomSnapshot,
} from '@draw-guess/shared'
import { serverStrings } from '@draw-guess/strings'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { createGameHarness, testRoomSettings, type GameHarness } from './helpers/game-harness.ts'
import { errorCodeOf, startRelayGame } from './helpers/relay-game-fixture.ts'

/** 建一个接龙房并让指定成员全部就位；返回房主与其余成员与开局前版本号。 */
function relayRoomBeforeStart(
  harness: GameHarness,
  playerCount: number,
  settings: Partial<RoomSettings> = {},
) {
  const registrations = Array.from({ length: playerCount }, (_, index) => {
    const nickname = index === 0 ? '房主' : `玩家${index + 1}`
    return { nickname, ...harness.register(nickname) }
  })
  const [host, ...guests] = registrations
  if (!host) throw new Error('测试房缺少房主')
  const created = harness.service.createRoom(host.playerId, {
    name: '接龙门禁房',
    visibility: 'public',
    gameMode: 'relay',
    settings: testRoomSettings(settings),
  })
  let latest = created
  for (const guest of guests) latest = harness.service.joinRoom(guest.playerId, created.id)
  const room = harness.service.rooms.get(created.id)
  if (!room) throw new Error('接龙房未创建')
  return { host, guests, room, version: latest.stateVersion }
}

/** 让所有非房主成员准备（房主为隐式准备，S62 沿用经典准备口径）。 */
function readyAll(harness: GameHarness, guests: { playerId: string }[]): number {
  let version = 0
  for (const guest of guests) version = harness.service.setReady(guest.playerId, true).stateVersion
  return version
}

describe('接龙开局门禁', () => {
  it('4 人全员准备后开局：进入 starting 倒计时，到期进入步 1 选词', () => {
    const harness = createGameHarness()
    const { host, guests, room, version } = relayRoomBeforeStart(harness, RELAY_MIN_PLAYERS)
    harness.service.startGame(host.playerId, readyAll(harness, guests))

    // 开局先复用经典 starting 倒计时（S22），此阶段还没有接龙视图（视图阶段是接龙子集）
    expect(room.phase).toBe('starting')
    expect(room.relay?.chains).toHaveLength(RELAY_MIN_PLAYERS)
    // 接龙房只挂 relay，不挂经典 game：两个秘密字段由 gameMode 保证恰一个非空（S56）
    expect(room.game).toBeUndefined()
    expect(harness.service.snapshotForPlayer(host.playerId)?.relay).toBeUndefined()

    harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)

    expect(room.phase).toBe('relay_choose')
    expect(room.relay?.currentStep).toBe(1)
    // 倒计时结束后全员进入选词：准备位被清空（与经典 beginGame 同口径）
    expect(room.members.every((member) => !member.ready)).toBe(true)
    // 版本号在开局推进中被递增（starting → relay_choose）
    expect(room.stateVersion).toBeGreaterThan(version)
  })

  it('链数组按席位顺序建立：players[i] 是链 i 的发起人，每人候选都来自自己的池', () => {
    const scenario = startRelayGame({ playerCount: 5 })

    expect(scenario.relay.chains.map((chain) => chain.originPlayerId)).toEqual(
      scenario.players.map((player) => player.playerId),
    )
    // 候选数 = 房间规则 optionCount（默认 3），每条链各自一份（S31）
    expect(testRoomSettings().optionCount).toBe(3)
    for (const chain of scenario.relay.chains) {
      expect(chain.candidates).toHaveLength(testRoomSettings().optionCount)
      expect(chain.rerollUsed).toBe(false)
    }
    // 每人的快照里只有一个步 id、一个当前步与自己的候选
    scenario.players.forEach((player) => {
      const view = scenario.snapshotOf(player.playerId).relay
      expect(view?.phase).toBe('relay_choose')
      expect(view?.currentStep).toBe(1)
      expect(view?.stepId).toBe(scenario.stepId)
      expect(view?.submitted).toBe(false)
      expect(view?.canReroll).toBe(true)
      const own = scenario.chainOf(player.playerId, 1).candidates.map((word) => word.id)
      expect(view?.wordOptions?.map((word) => word.id)).toEqual(own)
    })
  })

  it('在线且可玩不足 4 人被拒：3 人在线不行，4 人中有 1 人掉线也不行', () => {
    const threeHarness = createGameHarness()
    const three = relayRoomBeforeStart(threeHarness, RELAY_MIN_PLAYERS - 1)
    const threeVersion = readyAll(threeHarness, three.guests)
    expect(
      errorCodeOf(() => threeHarness.service.startGame(three.host.playerId, threeVersion)),
    ).toBe(ERROR_CODES.NOT_ENOUGH_PLAYERS)
    // 文案里的下限取自协议常量，不是写死的 2 人
    expect(() => threeHarness.service.startGame(three.host.playerId, threeVersion)).toThrow(
      serverStrings.errors.NOT_ENOUGH_PLAYERS_RELAY(RELAY_MIN_PLAYERS),
    )

    const fourHarness = createGameHarness()
    const four = relayRoomBeforeStart(fourHarness, RELAY_MIN_PLAYERS)
    const fourVersion = readyAll(fourHarness, four.guests)
    const leaving = four.guests[0]
    if (!leaving) throw new Error('测试房缺少成员')
    fourHarness.service.handleDisconnect(leaving.socket as never)
    // 掉线会让成员离开房间并递增版本号：用最新版本号发开局请求，才能命中人数门禁而不是版本冲突
    expect(four.room.stateVersion).toBeGreaterThan(fourVersion)
    expect(
      errorCodeOf(() => fourHarness.service.startGame(four.host.playerId, four.room.stateVersion)),
    ).toBe(ERROR_CODES.NOT_ENOUGH_PLAYERS)
  })

  it('未全员准备被拒（房主为隐式准备），全员准备后放行', () => {
    const harness = createGameHarness()
    const { host, guests } = relayRoomBeforeStart(harness, RELAY_MIN_PLAYERS)
    const firstGuest = guests[0]
    if (!firstGuest) throw new Error('测试房缺少成员')
    // 只让第一个客人准备：其余客人仍未准备
    const version = harness.service.setReady(firstGuest.playerId, true).stateVersion

    expect(errorCodeOf(() => harness.service.startGame(host.playerId, version))).toBe(
      ERROR_CODES.NOT_ALL_READY,
    )

    let readyVersion = version
    for (const guest of guests.slice(1))
      readyVersion = harness.service.setReady(guest.playerId, true).stateVersion
    expect(harness.service.startGame(host.playerId, readyVersion).phase).toBe('starting')
  })

  it('经典房不受接龙门禁影响：2 人可开局（门禁按模式分流）', () => {
    const harness = createGameHarness()
    const host = harness.register('经典房主')
    const guest = harness.register('经典客人')
    const created = harness.service.createRoom(host.playerId, {
      name: '经典房',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    harness.service.joinRoom(guest.playerId, created.id)
    const ready = harness.service.setReady(guest.playerId, true)

    const snapshot: RoomSnapshot = harness.service.startGame(host.playerId, ready.stateVersion)

    expect(snapshot.phase).toBe('starting')
    expect(harness.service.rooms.get(created.id)?.game).toBeDefined()
    expect(harness.service.rooms.get(created.id)?.relay).toBeUndefined()
  })
})

describe('接龙开局现场', () => {
  it('步 1 的全局步 id 唯一且阶段时间按房间规则计算（选词 20 秒）', () => {
    const scenario = startRelayGame({ settings: { relayChooseSeconds: 30 } })

    const startedAt = scenario.relay.phaseStartedAt
    expect(scenario.relay.phaseEndsAt - startedAt).toBe(30 * 1_000)
    // 步数常量与开局现场一致：开局永远在步 1，且步号不越过协议上界
    expect(scenario.relay.currentStep).toBe(1)
    expect(scenario.relay.currentStep).toBeLessThanOrEqual(RELAY_STEP_COUNT)
    const view = scenario.snapshotOf(scenario.host.playerId).relay
    expect(view?.phaseStartedAt).toBe(startedAt)
    expect(view?.phaseEndsAt).toBe(scenario.relay.phaseEndsAt)
  })

  it('开局通知只播关键节点：选词开始时播「接龙开始」一次', () => {
    const scenario = startRelayGame()

    // 入房通知是等待阶段的既有行为；接龙的关键节点通知只有开局一次，提交不会逐条播报（S65）
    const notices = scenario.notices()
    expect(notices.filter((text) => text === serverStrings.notices.relayStarted)).toHaveLength(1)
    expect(notices).not.toContain(serverStrings.notices.relayStepStarted(2))

    scenario.chooseAll()
    scenario.submitAllDrawings()
    const after = scenario.notices()
    expect(after.filter((text) => text === serverStrings.notices.relayStepStarted(2))).toHaveLength(
      1,
    )
  })
})
