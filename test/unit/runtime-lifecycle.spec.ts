import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { startTwoPlayerGame, createGameHarness, testRoomSettings } from './helpers/game-harness.ts'

describe('统一假运行时驱动完整回合生命周期', () => {
  it('开始→选词→作画→提示→暂停→恢复→结算的时间戳与入账分保持一致', () => {
    const harness = createGameHarness()
    const { host, guest, room, game } = startTwoPlayerGame(
      harness,
      testRoomSettings({ drawSeconds: 90, chooseSeconds: 10, allowChooseTimeLimit: true }),
    )
    expect(room.phase).toBe('choosing_word')
    const answer = game.candidates[0]!
    harness.service.chooseWord(game.drawerId, game.roundId, answer.id)
    expect(room.phase).toBe('drawing')
    expect(game.phaseStartedAt).toBe(harness.runtime.now())
    expect(game.phaseEndsAt - game.phaseStartedAt).toBe(90_000)

    // 逐步提示：等待首个揭示窗口后，猜词者经快照看到的逐字遮罩应真正揭开至少一个字符（不锁内部下标簿记）。
    const guesser = game.drawerId === host.playerId ? guest : host
    const maskBefore = harness.service.snapshotForPlayer(guesser.playerId)?.game?.answerMask
    harness.runtime.advance(90_000 * APP_CONFIG.game.progressiveHintRatio + 1)
    const maskAfter = harness.service.snapshotForPlayer(guesser.playerId)?.game?.answerMask
    expect(maskAfter).toBeDefined()
    expect(maskAfter).not.toBe(maskBefore)
    expect(maskAfter?.length).toBe(maskBefore?.length)

    const remainingBeforePause = game.phaseEndsAt - harness.runtime.now()
    harness.service.pause(host.playerId, '测试暂停')
    expect(room.phase).toBe('paused')
    expect(game.pauseState?.remainingMs).toBe(remainingBeforePause)
    harness.runtime.advance(30_000)
    expect(room.phase).toBe('paused')

    harness.service.resume(host.playerId)
    expect(room.phase).toBe('drawing')
    expect(game.phaseEndsAt - harness.runtime.now()).toBe(remainingBeforePause)
    expect(harness.service.submitGuess(guesser.playerId, game.roundId, answer.text)).toEqual({
      correct: true,
    })
    expect(room.phase).toBe('round_result')
    const detail = game.correctDetails[0]!
    const member = room.members.find((item) => item.playerId === guesser.playerId)!
    expect(member.score).toBe(detail.total)
    expect(game.roundResult?.details[0]).toEqual(detail)
    const resultDurationMs =
      (room.settings.allowRoundReplay
        ? APP_CONFIG.game.roundReplaySeconds + APP_CONFIG.game.roundResultSeconds
        : APP_CONFIG.game.roundResultSeconds) * 1_000
    expect(game.phaseEndsAt - game.phaseStartedAt).toBe(resultDurationMs)

    // 第二回合交给所有权威定时器自动推进，最终应只归档一次并进入 game_result。
    harness.runtime.advance(resultDurationMs)
    expect(room.phase).toBe('choosing_word')
    harness.runtime.advance(room.settings.chooseSeconds * 1_000)
    expect(room.phase).toBe('drawing')
    harness.runtime.advance(game.roundDurationMs)
    expect(room.phase).toBe('round_result')
    harness.runtime.advance(resultDurationMs)
    expect(room.phase).toBe('game_result')
    expect(game.currentRound).toBe(game.totalRounds)
    expect(harness.repositories.archive.games).toHaveLength(1)
    expect(harness.runtime.pendingTimerCount()).toBe(2)
  })
})
