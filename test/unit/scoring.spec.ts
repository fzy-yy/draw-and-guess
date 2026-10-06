import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '@draw-guess/config'
import { guessScoreForOrder } from '@draw-guess/shared'
import type { MemberState } from '../../apps/server/src/models.ts'
import { createGameHarness, testRoomSettings, type GameHarness } from './helpers/game-harness.ts'

/**
 * 固定 100 分制计分：猜词者按本回合猜中顺序得 100/80/60/40/20，
 * 画家每人 20 分、单回合上限 100（见 docs/adr/0047-fixed-100-point-scoring.md）。
 * 断言的是「玩完一回合后玩家实际拿到的分」这一外部行为，不锁内部计算函数。
 */
function startGame(harness: GameHarness, guesserCount: number) {
  const host = harness.register('房主')
  const guests = Array.from({ length: guesserCount }, (_item, index) =>
    harness.register(`客人${index + 1}`),
  )
  const room = harness.service.createRoom(host.playerId, {
    name: '测试房间',
    visibility: 'public',
    settings: testRoomSettings({ drawSeconds: 60 }),
  })
  let stateVersion = room.stateVersion
  for (const guest of guests)
    stateVersion = harness.service.joinRoom(guest.playerId, room.id).stateVersion
  for (const guest of guests)
    stateVersion = harness.service.setReady(guest.playerId, true).stateVersion
  harness.service.startGame(host.playerId, stateVersion)
  harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)
  const secret = harness.service.rooms.get(room.id)
  if (!secret?.game) throw new Error('对局未启动')
  return { host, guests, room: secret, game: secret.game }
}

/** 本回合的猜词者（非画家）：画家由服务端洗牌指派，故从房间实况取。 */
function guessersOf(room: { members: MemberState[] }, drawerId: string): MemberState[] {
  return room.members.filter((member) => member.playerId !== drawerId)
}

describe('固定 100 分制计分', () => {
  it('按猜中顺序依次得分，画家按猜中人数得分且封顶 100', () => {
    const harness = createGameHarness()
    const { room, game } = startGame(harness, 5)
    const answer = game.candidates[0]
    if (!answer) throw new Error('测试词库未生成候选词')
    harness.service.chooseWord(game.drawerId, game.roundId, answer.id)

    const guessers = guessersOf(room, game.drawerId)
    for (const guesser of guessers)
      expect(harness.service.submitGuess(guesser.playerId, game.roundId, answer.text)).toEqual({
        correct: true,
      })

    const orderScores = APP_CONFIG.game.score.orderScores
    expect(game.correctDetails.map((detail) => detail.order)).toEqual(
      guessers.map((_member, index) => index + 1),
    )
    expect(game.correctDetails.map((detail) => detail.total)).toEqual(
      guessers.map((_member, index) => guessScoreForOrder(index + 1, orderScores)),
    )
    expect(game.roundResult?.drawerScore).toBe(
      Math.min(
        APP_CONFIG.game.score.drawerMaxScore,
        guessers.length * APP_CONFIG.game.score.drawerPerCorrect,
      ),
    )
  })

  it('两人局唯一猜词者仍拿满分，画家只拿 20 分', () => {
    const harness = createGameHarness()
    const { room, game } = startGame(harness, 1)
    const answer = game.candidates[0]
    if (!answer) throw new Error('测试词库未生成候选词')
    harness.service.chooseWord(game.drawerId, game.roundId, answer.id)
    const only = guessersOf(room, game.drawerId)[0]
    if (!only) throw new Error('未生成猜词者')
    harness.service.submitGuess(only.playerId, game.roundId, answer.text)

    expect(game.correctDetails.map((detail) => detail.total)).toEqual([100])
    expect(game.roundResult?.drawerScore).toBe(20)
  })

  it('无人猜中时画家得 0 分', () => {
    const harness = createGameHarness()
    const { room, game } = startGame(harness, 2)
    const answer = game.candidates[0]
    if (!answer) throw new Error('测试词库未生成候选词')
    harness.service.chooseWord(game.drawerId, game.roundId, answer.id)
    // 作画时长耗尽，无人猜中
    harness.runtime.advance(room.settings.drawSeconds * 1_000)

    expect(game.roundResult?.details).toEqual([])
    expect(game.roundResult?.drawerScore).toBe(0)
  })
})
