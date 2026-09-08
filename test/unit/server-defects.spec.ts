import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import type { Stroke } from '@draw-guess/shared'
import { GameError } from '../../apps/server/src/errors.ts'
import { createGameHarness, startTwoPlayerGame, testRoomSettings } from './helpers/game-harness.ts'

function enterDrawing() {
  const harness = createGameHarness()
  const state = startTwoPlayerGame(harness)
  const candidate = state.game.candidates[0]
  if (!candidate) throw new Error('测试词库未生成候选词')
  harness.service.chooseWord(state.game.drawerId, state.game.roundId, candidate.id)
  return { harness, ...state }
}

describe('会话恢复与断线时序', () => {
  it('恢复令牌跨服务重启后恢复同一玩家 UUID，房间按约定作废', () => {
    const first = createGameHarness()
    const player = first.register('重启玩家')
    first.service.createRoom(player.playerId, {
      name: '重启房',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    first.service.handleDisconnect(player.socket as never)

    const second = createGameHarness({
      runtime: first.runtime,
      repositories: first.repositories,
    })
    second.service.recoverOnStartup()
    const restored = second.register('忽略的新昵称', 'new-socket', player.recoveryToken)
    expect(restored.playerId).toBe(player.playerId)
    expect(second.service.requirePlayer(restored.playerId).roomId).toBeUndefined()
  })

  it('新 Socket 接管身份后，旧 Socket 的迟到断线不会误伤新连接', () => {
    const harness = createGameHarness()
    const first = harness.register('接管玩家', 'old-socket')
    const second = harness.register('接管玩家', 'new-socket', first.recoveryToken)
    expect(first.socket.disconnected).toBe(true)
    harness.service.handleDisconnect(first.socket as never)
    const player = harness.service.requirePlayer(second.playerId)
    expect(player.connected).toBe(true)
    expect(player.socketId).toBe('new-socket')
  })

  it('画家兼房主断线超过短宽限后结算回合并迁移房主', () => {
    const { harness, host, guest, room, game } = enterDrawing()
    expect(game.drawerId).toBe(host.playerId)
    harness.service.handleDisconnect(host.socket as never)
    harness.runtime.advance(APP_CONFIG.network.drawerReconnectGraceMs)
    expect(room.phase).toBe('round_result')
    expect(room.hostId).toBe(guest.playerId)
  })
})

describe('私密房与邀请竞态', () => {
  it('私密房 UUID 不能绕过短码入口，错误短码达到窗口上限后被限频', () => {
    const harness = createGameHarness()
    const host = harness.register('私密房主')
    const guest = harness.register('访客')
    const room = harness.service.createRoom(host.playerId, {
      name: '私密房',
      visibility: 'private',
      settings: testRoomSettings(),
    })
    expect(() => harness.service.joinRoom(guest.playerId, room.id)).toThrow(GameError)
    for (let index = 0; index < APP_CONFIG.room.privateJoinMaxAttempts; index += 1) {
      expect(() => harness.service.joinPrivateRoom(guest.playerId, 'AAAAAA')).toThrow(GameError)
    }
    expect(() => harness.service.joinPrivateRoom(guest.playerId, 'AAAAAA')).toThrow(/频繁/)
  })

  it('邀请过期与重复接受均拒绝，满员失败不会误消费邀请', () => {
    const harness = createGameHarness()
    const host = harness.register('邀请者')
    const target = harness.register('受邀者')
    const filler = harness.register('占位者')
    const room = harness.service.createRoom(host.playerId, {
      name: '邀请房',
      visibility: 'public',
      settings: testRoomSettings({ maxPlayers: 2 }),
    })

    const expiring = harness.service.sendInvite(host.playerId, target.playerId)
    harness.runtime.advance(APP_CONFIG.network.inviteExpiryMs)
    expect(() => harness.service.respondInvite(target.playerId, expiring.id, true)).toThrow(
      /邀请|失效|过期/,
    )

    harness.runtime.advance(APP_CONFIG.network.inviteCooldownMs)
    const pending = harness.service.sendInvite(host.playerId, target.playerId)
    harness.service.joinRoom(filler.playerId, room.id)
    expect(() => harness.service.respondInvite(target.playerId, pending.id, true)).toThrow(/满员/)
    expect(harness.service.invites.has(pending.id)).toBe(true)

    harness.service.leaveRoom(filler.playerId)
    expect(harness.service.respondInvite(target.playerId, pending.id, true)?.id).toBe(room.id)
    expect(() => harness.service.respondInvite(target.playerId, pending.id, true)).toThrow(
      /邀请|失效|过期/,
    )
  })
})

describe('快照隐私与绘图边界', () => {
  it('角色快照不泄露令牌、Secret 字段、候选词与私密码', () => {
    const harness = createGameHarness()
    const host = harness.register('房主')
    const guest = harness.register('客人')
    const created = harness.service.createRoom(host.playerId, {
      name: '私密对局',
      visibility: 'private',
      settings: testRoomSettings(),
    })
    const code = created.privateJoinCode
    if (!code) throw new Error('未生成私密码')
    harness.service.joinPrivateRoom(guest.playerId, code)
    const ready = harness.service.setReady(guest.playerId, true)
    harness.service.startGame(host.playerId, ready.stateVersion)
    harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)
    const room = harness.service.rooms.get(created.id)!
    const game = room.game!

    const hostChoosing = harness.service.snapshotForPlayer(host.playerId, true)!
    const guestChoosing = harness.service.snapshotForPlayer(guest.playerId, true)!
    expect(hostChoosing.privateJoinCode).toBe(code)
    expect(guestChoosing.privateJoinCode).toBeUndefined()
    const drawerSnapshot = game.drawerId === host.playerId ? hostChoosing : guestChoosing
    const guesserSnapshot = game.drawerId === host.playerId ? guestChoosing : hostChoosing
    expect(drawerSnapshot.game?.wordOptions?.length).toBeGreaterThan(0)
    expect(guesserSnapshot.game?.wordOptions).toBeUndefined()

    harness.service.chooseWord(game.drawerId, game.roundId, game.candidates[0]!.id)
    const drawerDrawing = harness.service.snapshotForPlayer(game.drawerId, true)!
    const guesserId = game.drawerId === host.playerId ? guest.playerId : host.playerId
    const guesserDrawing = harness.service.snapshotForPlayer(guesserId, true)!
    expect(drawerDrawing.game?.answer).toBe(game.answer?.text)
    expect(guesserDrawing.game?.answer).toBeUndefined()
    const serialized = JSON.stringify(guesserDrawing)
    for (const forbidden of ['token', 'requestCache', 'candidates', 'privateJoinCode', 'timer'])
      expect(serialized).not.toContain(forbidden)
  })

  it('拒绝乱序/重复/续接样式变化并执行点数预算，全量重同步包含完整历史', () => {
    const { harness, guest, room, game } = enterDrawing()
    const base: Stroke = {
      kind: 'stroke',
      id: 'stroke-1',
      tool: 'pen',
      color: '#1F2937',
      width: 5,
      sequence: 0,
      startPointIndex: 0,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ],
    }
    expect(harness.service.addStroke(game.drawerId, game.roundId, base).drawingRevision).toBe(1)
    expect(() => harness.service.addStroke(game.drawerId, game.roundId, base)).toThrow(/过期|重复/)
    harness.runtime.advance(1_000)
    expect(() =>
      harness.service.addStroke(game.drawerId, game.roundId, {
        ...base,
        sequence: 1,
        startPointIndex: 2,
        color: '#EF4444',
        points: [{ x: 0.3, y: 0.3 }],
      }),
    ).toThrow(/颜色|线宽|样式|一致/)

    game.strokePointTotal = APP_CONFIG.drawing.maxPointsPerRound - 1
    harness.runtime.advance(1_000)
    expect(() =>
      harness.service.addStroke(game.drawerId, game.roundId, {
        ...base,
        id: 'stroke-budget',
        sequence: 2,
      }),
    ).toThrow(/上限|预算/)

    game.strokePointTotal = base.points.length
    const guestMember = room.members.find((member) => member.playerId === guest.playerId)!
    guestMember.lastSyncedSeq = undefined
    const full = harness.service.snapshotForPlayer(guest.playerId, true)!
    expect(full.game?.strokesOmitted).not.toBe(true)
    expect(full.game?.strokes).toHaveLength(1)
  })
})
