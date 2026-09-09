import { describe, expect, it } from 'vitest'
import { RoomSnapshotSchema } from '@draw-guess/shared'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { GameError } from '../../apps/server/src/errors.ts'
import { createGameHarness, startTwoPlayerGame, testRoomSettings } from './helpers/game-harness.ts'

describe('next_game 中途候场', () => {
  it('占用容量但不进入当前局裁决，并在返回等待时转为普通未准备成员', () => {
    const harness = createGameHarness()
    const { host, room, game } = startTwoPlayerGame(
      harness,
      testRoomSettings({ maxPlayers: 3, joinPolicy: 'next_game' }),
    )
    const candidate = harness.register('候场玩家')

    harness.service.round.beginDrawing(room, game.candidates[0]!)

    const joined = harness.service.joinRoom(candidate.playerId, room.id)
    const candidateMember = room.members.find((member) => member.playerId === candidate.playerId)!

    expect(RoomSnapshotSchema.safeParse(joined).success).toBe(true)
    expect(candidateMember).toMatchObject({
      spectating: true,
      waitingForNextGame: true,
      ready: false,
      score: 0,
    })
    expect(game.drawerOrder).not.toContain(candidate.playerId)
    expect(game.totalRounds).toBe(2)
    expect(joined.game?.answer).toBeUndefined()
    expect(joined.game?.wordOptions).toBeUndefined()
    expect(joined.game?.answerMask).not.toBe(game.answer?.text)

    expect(() => harness.service.submitGuess(candidate.playerId, game.roundId, '任意答案')).toThrow(
      GameError,
    )

    harness.service.endEarly(host.playerId)
    const resultView = harness.service.snapshotter.snapshot(room, candidate.playerId)
    expect(resultView.game?.finalRanking?.map((entry) => entry.id)).not.toContain(
      candidate.playerId,
    )

    harness.service.returnWaiting(candidate.playerId)
    harness.service.returnWaiting(host.playerId)
    harness.runtime.advance(APP_CONFIG.game.gameResultMinSeconds * 1_000)
    expect(room.phase).toBe('waiting')
    expect(room.game).toBeUndefined()
    expect(candidateMember).toMatchObject({
      spectating: false,
      waitingForNextGame: false,
      ready: false,
      score: 0,
    })
    expect(harness.service.setReady(candidate.playerId, true).members).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: candidate.playerId, ready: true })]),
    )
  })

  it('候场成员计入容量，且不能在房主离开时接管当前局', () => {
    const harness = createGameHarness()
    const { host, guest, room } = startTwoPlayerGame(
      harness,
      testRoomSettings({ maxPlayers: 3, joinPolicy: 'next_game' }),
    )
    const candidate = harness.register('候场玩家')
    harness.service.joinRoom(candidate.playerId, room.id)

    const overflow = harness.register('超额玩家')
    expect(() => harness.service.joinRoom(overflow.playerId, room.id)).toThrowError(
      expect.objectContaining({ code: 'ROOM_FULL' }),
    )

    harness.service.leaveGame(host.playerId)
    expect(room.hostId).toBe(guest.playerId)
    expect(room.hostId).not.toBe(candidate.playerId)
  })

  it('候场成员断线按非参赛成员立即释放席位', () => {
    const harness = createGameHarness()
    const { room } = startTwoPlayerGame(
      harness,
      testRoomSettings({ maxPlayers: 3, joinPolicy: 'next_game' }),
    )
    const candidate = harness.register('断线候场')
    harness.service.joinRoom(candidate.playerId, room.id)

    harness.service.handleDisconnect(candidate.socket as never)

    expect(room.members.some((member) => member.playerId === candidate.playerId)).toBe(false)
    expect(harness.service.requirePlayer(candidate.playerId).roomId).toBeUndefined()
  })

  it('开局倒计时取消回到等待时同样晋升候场成员', () => {
    const harness = createGameHarness()
    const host = harness.register('房主')
    const guest = harness.register('当前局玩家')
    const candidate = harness.register('倒计时候场')
    const created = harness.service.createRoom(host.playerId, {
      name: '倒计时候场房',
      visibility: 'public',
      settings: testRoomSettings({ maxPlayers: 3, joinPolicy: 'next_game' }),
    })
    harness.service.joinRoom(guest.playerId, created.id)
    const ready = harness.service.setReady(guest.playerId, true)
    harness.service.startGame(host.playerId, ready.stateVersion)
    harness.service.joinRoom(candidate.playerId, created.id)

    harness.service.leaveGame(guest.playerId)

    const room = harness.service.rooms.get(created.id)!
    const candidateMember = room.members.find((member) => member.playerId === candidate.playerId)
    expect(room.phase).toBe('waiting')
    expect(candidateMember).toMatchObject({
      spectating: false,
      waitingForNextGame: false,
      ready: false,
    })
  })
})
