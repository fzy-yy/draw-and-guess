import { describe, expect, it } from 'vitest'
import { EVENTS, SERVER_PUSH_SCHEMAS } from '@draw-guess/shared'
import { createGameHarness, testRoomSettings, type GameHarness } from './helpers/game-harness.ts'
import { startRelayGame } from './helpers/relay-game-fixture.ts'
import type { RoomSnapshot } from '@draw-guess/shared'

/**
 * 快照线协议契约回归（缺陷：玩家退出后房主提前结束，客户端卡在对局页）。
 *
 * 观测缝＝「服务端产出的 roomSnapshot 必须能被客户端解码器消费」：
 * 客户端收到的载荷先经 `SERVER_PUSH_SCHEMAS[room:snapshot]` 严格解码，任何协议未声明的字段
 * 都会让**整份快照被丢弃**——房主已提前结束（服务端 phase=game_result），客户端却停在对局页，
 * 于是画家画不了、别人也发不出消息。本文件用与线上同一条解码路径锁死该契约，
 * 并复刻 socket.io 的 JSON 序列化（`undefined` 属性会在路上被丢掉，这是「无离局者时看起来正常」的原因）。
 */
function decodeAsClient(snapshot: RoomSnapshot) {
  // socket.io 载荷经 JSON 序列化：值为 undefined 的属性不会出现在线上，必须一并复刻。
  const wire = JSON.parse(JSON.stringify({ protocolVersion: '20', data: snapshot }))
  return SERVER_PUSH_SCHEMAS[EVENTS.roomSnapshot].safeParse(wire)
}

function expectAllSnapshotsDecodable(harness: GameHarness, label: string): void {
  const room = [...harness.service.rooms.values()][0]
  if (!room) throw new Error('场景缺少房间')
  for (const member of room.members) {
    const decision = decodeAsClient(harness.service.snapshotter.snapshot(room, member.playerId))
    expect(
      decision.success,
      `${label}：成员 ${member.playerId} 的 roomSnapshot 无法被客户端解码（` +
        `${decision.success ? '' : decision.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}）`,
    ).toBe(true)
  }
}

/** 起一局经典三人对局并推进到作画阶段（返回房主与房主所在房间）。 */
function startThreePlayerClassic(harness: GameHarness) {
  const host = harness.register('房主')
  const guest1 = harness.register('客人一')
  const guest2 = harness.register('客人二')
  const room = harness.service.createRoom(host.playerId, {
    name: '契约房间',
    visibility: 'public',
    settings: testRoomSettings(),
  })
  harness.service.joinRoom(guest1.playerId, room.id)
  harness.service.joinRoom(guest2.playerId, room.id)
  harness.service.setReady(guest1.playerId, true)
  harness.service.setReady(guest2.playerId, true)
  harness.service.startGame(host.playerId, harness.service.rooms.get(room.id)!.stateVersion)
  harness.runtime.advance(3_000)
  const playing = harness.service.rooms.get(room.id)!
  harness.service.chooseWord(
    playing.game!.drawerId,
    playing.game!.roundId,
    playing.game!.candidates[0]!.id,
  )
  return { host, guest1, guest2 }
}

describe('roomSnapshot 线协议契约（经典模式）', () => {
  it('有玩家退出本局后房主提前结束，全部成员快照仍可被客户端解码', () => {
    const harness = createGameHarness()
    const { host, guest2 } = startThreePlayerClassic(harness)
    const room = harness.service.rooms.get([...harness.service.rooms.keys()][0]!)!

    harness.service.leaveGame(guest2.playerId)
    harness.service.endEarly(host.playerId)
    expect(room.phase).toBe('game_result')

    expectAllSnapshotsDecodable(harness, '经典：离局者留在终局榜')
  })

  it('有玩家断线（席位保留）后房主提前结束，全部成员快照仍可被客户端解码', () => {
    const harness = createGameHarness()
    const { host, guest2 } = startThreePlayerClassic(harness)

    harness.service.handleDisconnect(guest2.socket as never)
    harness.service.endEarly(host.playerId)

    expectAllSnapshotsDecodable(harness, '经典：断线者席位保留')
  })
})

describe('roomSnapshot 线协议契约（接龙模式）', () => {
  it('有玩家退出后房主提前结束，全部成员快照仍可被客户端解码', () => {
    const scenario = startRelayGame({ playerCount: 4 })
    scenario.chooseAll()
    scenario.harness.service.leaveGame(scenario.players[1]!.playerId)
    scenario.harness.service.endEarly(scenario.host.playerId)

    expectAllSnapshotsDecodable(scenario.harness, '接龙：离局者留在终局榜')
  })

  it('接龙自由聊天写入的消息 id 满足协议（否则整份快照会被客户端丢弃）', () => {
    const scenario = startRelayGame({ playerCount: 4 })
    scenario.chooseAll()
    const speaker = scenario.players[1]!

    scenario.harness.service.sendRelayChat(speaker.playerId, '这条消息必须能到达其他玩家')

    const snapshot = scenario.harness.service.snapshotter.snapshot(
      scenario.room,
      scenario.host.playerId,
    )
    const decoded = decodeAsClient(snapshot)
    expect(
      decoded.success,
      decoded.success
        ? ''
        : `聊天消息污染了快照：${decoded.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    ).toBe(true)
    // 消息确实进了房间聊天流（不是被静默丢弃）
    const texts = snapshot.relay?.messages.map((message) => message.text) ?? []
    expect(texts).toContain('这条消息必须能到达其他玩家')
  })

  it('聊天之后全员提交第二棒答案，快照仍可解码且已推进到第三棒作画', () => {
    const scenario = startRelayGame({ playerCount: 4 })
    scenario.chooseAll()
    scenario.harness.service.sendRelayChat(scenario.players[0]!.playerId, '第一棒聊天')
    scenario.submitAllDrawings()

    // 第二棒（猜词）：最后一名玩家提交后必须推进到第三棒作画
    scenario.submitAllGuesses()

    expect(scenario.room.phase).toBe('relay_draw')
    expect(scenario.step).toBe(3)
    expectAllSnapshotsDecodable(scenario.harness, '接龙：第二棒提交后推进')
  })
})
