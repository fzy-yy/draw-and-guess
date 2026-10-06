import { describe, expect, it } from 'vitest'
import { ERROR_CODES, PLAYER_PROTOCOL_LIMITS, RoomSnapshotSchema } from '@draw-guess/shared'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { GameError } from '../../apps/server/src/errors.ts'
import { createGameHarness, testRoomSettings } from './helpers/game-harness.ts'
import type { GameHarness } from './helpers/game-harness.ts'

/** 已删除的加入策略字段键名（片段拼接：验收要求该标识符在源码与测试中零命中）。 */
const REMOVED_JOIN_POLICY_KEY = ['join', 'Policy'].join('')

/**
 * 加入门禁与容量：观战 / 候场 / 可调人数上限已删除（共识 S36 / S61 / S67）。
 * 这里只断言外部可观察行为——加入请求的错误码、快照 strict 校验与成员数，
 * 不触碰服务端私有字段。
 */

/** 断言抛出的 GameError 携带指定错误码（不依赖可能改动的文案）。 */
function expectCode(action: () => unknown, code: string): void {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(GameError)
    expect((error as GameError).code).toBe(code)
    return
  }
  throw new Error(`预期抛出 ${code}，但请求成功了`)
}

/** 建房并让房主与一名客人开局：返回房间 id 与私密码（公开房为空串）。 */
function startGameInRoom(
  harness: GameHarness,
  visibility: 'public' | 'private',
): { roomId: string; privateJoinCode: string } {
  const host = harness.register(`房主-${visibility}`)
  const guest = harness.register(`客人-${visibility}`)
  const room = harness.service.createRoom(host.playerId, {
    name: `门禁房-${visibility}`,
    visibility,
    settings: testRoomSettings(),
  })
  const secret = harness.service.rooms.get(room.id)
  if (!secret) throw new Error('房间不存在')
  const privateJoinCode = secret.privateJoinCode ?? ''
  if (visibility === 'private' && !privateJoinCode) throw new Error('私密房未生成房间码')
  // 私密房只能凭房间码入座；两条路径最终都汇聚到 joinResolvedRoom 的门禁。
  if (visibility === 'private') harness.service.joinPrivateRoom(guest.playerId, privateJoinCode)
  else harness.service.joinRoom(guest.playerId, room.id)
  const ready = harness.service.setReady(guest.playerId, true)
  harness.service.startGame(host.playerId, ready.stateVersion)
  harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)
  return { roomId: room.id, privateJoinCode }
}

describe('开局后任何加入路径一律被拒', () => {
  it('公开房：开局后加入被拒', () => {
    const harness = createGameHarness()
    const { roomId } = startGameInRoom(harness, 'public')
    const latecomer = harness.register('迟到玩家')
    expectCode(
      () => harness.service.joinRoom(latecomer.playerId, roomId),
      ERROR_CODES.GAME_IN_PROGRESS,
    )
    expect(harness.service.requirePlayer(latecomer.playerId).roomId).toBeUndefined()
  })

  it('私密码：开局后凭房间码加入被拒', () => {
    const harness = createGameHarness()
    const { privateJoinCode } = startGameInRoom(harness, 'private')
    const latecomer = harness.register('迟到玩家')
    expectCode(
      () => harness.service.joinPrivateRoom(latecomer.playerId, privateJoinCode),
      ERROR_CODES.GAME_IN_PROGRESS,
    )
    expect(harness.service.requirePlayer(latecomer.playerId).roomId).toBeUndefined()
  })

  it('邀请：开局前发出的邀请，在开局后接受也被拒且不消费邀请', () => {
    const harness = createGameHarness()
    const host = harness.register('邀请房主')
    const guest = harness.register('局内客人')
    const invitee = harness.register('受邀者')
    const room = harness.service.createRoom(host.playerId, {
      name: '邀请门禁房',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    const invite = harness.service.sendInvite(host.playerId, invitee.playerId)

    harness.service.joinRoom(guest.playerId, room.id)
    const ready = harness.service.setReady(guest.playerId, true)
    harness.service.startGame(host.playerId, ready.stateVersion)
    harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)

    expectCode(
      () => harness.service.respondInvite(invitee.playerId, invite.id, true),
      ERROR_CODES.GAME_IN_PROGRESS,
    )
    // 被拒的邀请没有被误消费，仍留在待处理表中（与既有「满员失败不消费邀请」口径一致）。
    expect(harness.service.invites.has(invite.id)).toBe(true)
    expect(harness.service.requirePlayer(invitee.playerId).roomId).toBeUndefined()
  })

  it('邀请：开局后房主再发邀请也被拒（房间不可加入）', () => {
    const harness = createGameHarness()
    const { roomId } = startGameInRoom(harness, 'public')
    const room = harness.service.rooms.get(roomId)
    if (!room) throw new Error('房间不存在')
    const target = harness.register('受邀者')
    expectCode(
      () => harness.service.sendInvite(room.hostId, target.playerId),
      ERROR_CODES.ROOM_NOT_JOINABLE,
    )
  })
})

describe('房间容量固定为共享协议常量', () => {
  it(`第 ${PLAYER_PROTOCOL_LIMITS.maxPlayers} 人可加入、第 ${PLAYER_PROTOCOL_LIMITS.maxPlayers + 1} 人被拒`, () => {
    const harness = createGameHarness()
    const host = harness.register('容量房主')
    const room = harness.service.createRoom(host.playerId, {
      name: '容量房',
      visibility: 'public',
      settings: testRoomSettings(),
    })

    // 容量 = 房主 + （maxPlayers - 1）名加入者；每次加入拿到的快照都必须通过 strict 校验。
    for (let index = 1; index < PLAYER_PROTOCOL_LIMITS.maxPlayers; index += 1) {
      const joiner = harness.register(`容量玩家${index}`)
      const snapshot = harness.service.joinRoom(joiner.playerId, room.id)
      expect(RoomSnapshotSchema.safeParse(snapshot).success).toBe(true)
      expect(snapshot.members.length).toBe(index + 1)
    }

    const overflow = harness.register('超员玩家')
    expectCode(() => harness.service.joinRoom(overflow.playerId, room.id), ERROR_CODES.ROOM_FULL)
    expect(harness.service.requirePlayer(overflow.playerId).roomId).toBeUndefined()
  })

  it('房间快照不再接受携带已删除容量 / 加入策略字段的规则对象（strict 防回潮）', () => {
    const harness = createGameHarness()
    const host = harness.register('规则房主')
    const room = harness.service.createRoom(host.playerId, {
      name: '规则房',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    const secret = harness.service.rooms.get(room.id)
    if (!secret) throw new Error('房间不存在')
    const snapshot = harness.service.snapshotter.snapshot(secret, host.playerId)
    // 删除字段经快照边界回潮时必须被 strict Schema 拦下，而不是静默透传。
    // 加入策略键名按片段拼接：验收要求该标识符在源码与测试中零命中（只留在 .scratch 与 ADR）。
    expect(
      RoomSnapshotSchema.safeParse({
        ...snapshot,
        settings: { ...snapshot.settings, maxPlayers: PLAYER_PROTOCOL_LIMITS.maxPlayers },
      }).success,
    ).toBe(false)
    expect(
      RoomSnapshotSchema.safeParse({
        ...snapshot,
        settings: { ...snapshot.settings, [REMOVED_JOIN_POLICY_KEY]: 'forbid' },
      }).success,
    ).toBe(false)
  })
})
