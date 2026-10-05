import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { PLAYER_PROTOCOL_LIMITS, type Stroke } from '@draw-guess/shared'
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

  it('画家兼房主断线：房主控制权按短宽限迁移，回合不提前废弃、走完作画倒计时自然结算', () => {
    const { harness, host, guest, room, game } = enterDrawing()
    expect(game.drawerId).toBe(host.playerId)
    harness.service.handleDisconnect(host.socket as never)

    // 短宽限后房主控制权迁移给在线客人，但不提前结算回合（ADR-0059 断线挂机化）
    harness.runtime.advance(APP_CONFIG.network.hostReconnectGraceMs)
    expect(room.hostId).toBe(guest.playerId)
    expect(room.phase).toBe('drawing')

    // 作画倒计时走完，自然结算进入 round_result
    harness.runtime.advance(game.roundDurationMs - APP_CONFIG.network.hostReconnectGraceMs)
    expect(room.phase).toBe('round_result')
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
    // 容量固定为协议常量：填满房间需要房主 + (maxPlayers - 1) 名占位者
    const fillers = Array.from({ length: PLAYER_PROTOCOL_LIMITS.maxPlayers - 1 }, (_item, index) =>
      harness.register(`占位者${index + 1}`),
    )
    const room = harness.service.createRoom(host.playerId, {
      name: '邀请房',
      visibility: 'public',
      settings: testRoomSettings(),
    })

    const expiring = harness.service.sendInvite(host.playerId, target.playerId)
    harness.runtime.advance(APP_CONFIG.network.inviteExpiryMs)
    expect(() => harness.service.respondInvite(target.playerId, expiring.id, true)).toThrow(
      /邀请|失效|过期/,
    )

    harness.runtime.advance(APP_CONFIG.network.inviteCooldownMs)
    const pending = harness.service.sendInvite(host.playerId, target.playerId)
    for (const filler of fillers) harness.service.joinRoom(filler.playerId, room.id)
    expect(() => harness.service.respondInvite(target.playerId, pending.id, true)).toThrow(/满员/)
    expect(harness.service.invites.has(pending.id)).toBe(true)

    harness.service.leaveRoom(fillers[0]!.playerId)
    expect(harness.service.respondInvite(target.playerId, pending.id, true)?.id).toBe(room.id)
    expect(() => harness.service.respondInvite(target.playerId, pending.id, true)).toThrow(
      /邀请|失效|过期/,
    )
  })
})

describe('快照隐私与绘图边界', () => {
  // 角色快照的隐私守卫（Secret 字段/令牌/候选词/私密码/可见性真值）已由
  // test/unit/snapshot.matrix.spec.ts 的 54 格穷举矩阵接管（ADR-0021，严格超集）。

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

  it('单回合填充次数到达上限后拒绝新填充，撤销与清空会释放额度', () => {
    const { harness, game } = enterDrawing()
    const fill = (sequence: number) => ({
      kind: 'fill' as const,
      id: `fill-${sequence}`,
      point: { x: 0.5, y: 0.5 },
      color: '#EF4444',
      sequence,
    })
    const limit = APP_CONFIG.drawing.maxFillsPerRound
    for (let index = 0; index < limit; index += 1) {
      harness.runtime.advance(1_000) // 绕过服务端绘图事件限频
      harness.service.addFill(game.drawerId, game.roundId, fill(index))
    }
    harness.runtime.advance(1_000)
    expect(() => harness.service.addFill(game.drawerId, game.roundId, fill(limit))).toThrow(
      /上限|预算/,
    )

    // 撤销一次填充释放一次额度后可以继续提交
    harness.service.undo(game.drawerId, game.roundId)
    harness.runtime.advance(1_000)
    expect(() =>
      harness.service.addFill(game.drawerId, game.roundId, fill(limit + 1)),
    ).not.toThrow()

    // 清空画布同时清零点数与填充额度
    harness.service.clearDrawing(game.drawerId, game.roundId)
    expect(game.fillCount).toBe(0)
    expect(game.strokePointTotal).toBe(0)
  })

  it('画家作画阶段发送普通消息成功广播全员，发送答案或别称被拦截并提示无法发送答案', () => {
    const { harness, host, game } = enterDrawing()
    const drawerId = host.playerId
    expect(game.drawerId).toBe(drawerId)
    const answer = game.answer
    if (!answer) throw new Error('作画阶段应存在答案')

    // 1. 画家发送非答案聊天消息：成功进入消息流并广播
    const chatResult = harness.service.submitGuess(drawerId, game.roundId, '画得好不好看？')
    expect(chatResult).toEqual({ correct: false })
    const lastMsg = game.messages.at(-1)
    expect(lastMsg?.type).toBe('guess')
    expect(lastMsg?.playerId).toBe(drawerId)
    expect(lastMsg?.text).toBe('画得好不好看？')

    // 2. 画家发送完全匹配的答案词面：拦截并抛出 DRAWER_CANNOT_GUESS 且文案为无法发送答案
    expect(() => harness.service.submitGuess(drawerId, game.roundId, answer.text)).toThrowError(
      '无法发送答案',
    )
    try {
      harness.service.submitGuess(drawerId, game.roundId, answer.text)
    } catch (error) {
      expect((error as GameError).code).toBe('DRAWER_CANNOT_GUESS')
    }

    // 3. 若答案包含别称，发送别称同样被拦截
    if (answer.aliases.length > 0) {
      expect(() =>
        harness.service.submitGuess(drawerId, game.roundId, answer.aliases[0]!),
      ).toThrowError('无法发送答案')
    }
  })
})
