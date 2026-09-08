import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { canTransition, type RoomPhase } from '@draw-guess/shared'
import { createGameHarness, startTwoPlayerGame, testRoomSettings } from './helpers/game-harness.ts'

function enterDrawing() {
  const harness = createGameHarness()
  const state = startTwoPlayerGame(harness)
  const answer = state.game.candidates[0]
  if (!answer) throw new Error('测试词库未生成候选词')
  harness.service.chooseWord(state.game.drawerId, state.game.roundId, answer.id)
  return { harness, ...state }
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectTypeScriptFiles(path)
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('房间阶段转换边界', () => {
  it('暂停中的作画回合可直接结算，并只保留新的结算倒计时', () => {
    const { harness, host, room, game } = enterDrawing()
    harness.service.pause(host.playerId, '暂停后结算')
    const pausedVersion = room.stateVersion

    harness.service.round.finishRound(room, false)

    expect(room.phase).toBe('round_result')
    expect(room.stateVersion).toBe(pausedVersion + 1)
    expect(game.phaseBeforePause).toBeUndefined()
    expect(game.pausedRemainingMs).toBeUndefined()
    expect(harness.runtime.pendingTimerCount()).toBe(1)
    harness.runtime.advance(APP_CONFIG.game.roundResultSeconds * 1_000)
    expect(room.phase).toBe('choosing_word')
  })

  it('暂停中提前结束可直接进入最终结算并取消全部倒计时', () => {
    const { harness, host, room, game } = enterDrawing()
    harness.service.pause(host.playerId, '暂停后提前结束')
    const pausedVersion = room.stateVersion

    harness.service.endEarly(host.playerId)

    expect(room.phase).toBe('game_result')
    expect(room.stateVersion).toBe(pausedVersion + 1)
    expect(game.phaseBeforePause).toBeUndefined()
    expect(game.pausedRemainingMs).toBeUndefined()
    expect(harness.runtime.pendingTimerCount()).toBe(0)
    expect(harness.repositories.archive.games).toHaveLength(1)
  })

  it('开局倒计时中成员离开会返回等待并让旧回调失效', () => {
    const harness = createGameHarness()
    const host = harness.register('房主')
    const guest = harness.register('客人')
    const created = harness.service.createRoom(host.playerId, {
      name: '倒计时房间',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    harness.service.joinRoom(guest.playerId, created.id)
    const ready = harness.service.setReady(guest.playerId, true)
    harness.service.startGame(host.playerId, ready.stateVersion)
    const room = harness.service.rooms.get(created.id)!
    const startingVersion = room.stateVersion
    expect(room.phase).toBe('starting')
    expect(harness.runtime.pendingTimerCount()).toBe(1)

    harness.service.leaveRoom(guest.playerId)

    expect(room.phase).toBe('waiting')
    expect(room.stateVersion).toBe(startingVersion + 2)
    expect(room.game).toBeUndefined()
    expect(harness.runtime.pendingTimerCount()).toBe(0)
    harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)
    expect(room.phase).toBe('waiting')
  })

  it('最终结算返回等待只递增一次阶段版本并清理对局', () => {
    const { harness, host, room } = enterDrawing()
    harness.service.endEarly(host.playerId)
    room.members.forEach((member) => (member.ready = true))
    const resultVersion = room.stateVersion

    harness.service.returnWaiting(host.playerId)

    expect(room.phase).toBe('waiting')
    expect(room.stateVersion).toBe(resultVersion + 1)
    expect(room.game).toBeUndefined()
    expect(room.members.every((member) => !member.ready)).toBe(true)
    expect(harness.runtime.pendingTimerCount()).toBe(0)
  })

  it('关闭房间通过合法转换释放成员与持久化房间', () => {
    const harness = createGameHarness()
    const host = harness.register('单人房主')
    const created = harness.service.createRoom(host.playerId, {
      name: '待关闭房间',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    const room = harness.service.rooms.get(created.id)!
    const waitingVersion = room.stateVersion

    harness.service.leaveRoom(host.playerId)

    expect(room.phase).toBe('closed')
    expect(room.stateVersion).toBe(waitingVersion + 2)
    expect(harness.service.rooms.has(room.id)).toBe(false)
    expect(harness.repositories.rooms.listRooms()).toHaveLength(0)
    expect(host.socket.rooms.has(room.id)).toBe(false)
  })

  it('合法表允许所有活跃阶段关闭，并保留目标转换边', () => {
    expect(canTransition('paused', 'round_result')).toBe(true)
    expect(canTransition('paused', 'game_result')).toBe(true)
    expect(canTransition('starting', 'waiting')).toBe(true)
    expect(canTransition('game_result', 'waiting')).toBe(true)
    const phases: RoomPhase[] = [
      'waiting',
      'starting',
      'choosing_word',
      'drawing',
      'round_result',
      'paused',
      'game_result',
    ]
    expect(phases.every((phase) => canTransition(phase, 'closed'))).toBe(true)
  })
})

describe('房间阶段写入静态约束', () => {
  it('服务端只有 GameService.transition 可以直接赋值 phase', () => {
    const sourceRoot = fileURLToPath(new URL('../../apps/server/src/', import.meta.url))
    const assignments = collectTypeScriptFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      const dotAssignments = [...source.matchAll(/\.\s*phase\s*=(?!=)/g)]
      const bracketAssignments = [...source.matchAll(/\[\s*['"]phase['"]\s*\]\s*=(?!=)/g)]
      return [...dotAssignments, ...bracketAssignments].map((match) => ({
        file: relative(sourceRoot, path).replaceAll('\\', '/'),
        statement: source
          .slice(source.lastIndexOf('\n', match.index) + 1, source.indexOf('\n', match.index))
          .trim(),
      }))
    })

    expect(assignments).toEqual([{ file: 'game-service.ts', statement: 'room.phase = next' }])
  })
})
