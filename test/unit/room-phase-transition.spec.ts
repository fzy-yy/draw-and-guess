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
    expect(game.pauseState).toBeUndefined()
    expect(harness.runtime.pendingTimerCount()).toBe(1)
    const resultDurationMs =
      (room.settings.allowRoundReplay
        ? APP_CONFIG.game.roundReplaySeconds +
          APP_CONFIG.game.roundReplayPauseSeconds +
          APP_CONFIG.game.roundResultSeconds
        : APP_CONFIG.game.roundResultSeconds) * 1_000
    harness.runtime.advance(resultDurationMs)
    expect(room.phase).toBe('choosing_word')
  })

  it('暂停中提前结束可直接进入最终结算并只保留结算退出计时器', () => {
    const { harness, host, room, game } = enterDrawing()
    harness.service.pause(host.playerId, '暂停后提前结束')
    const pausedVersion = room.stateVersion

    harness.service.endEarly(host.playerId)

    expect(room.phase).toBe('game_result')
    expect(room.stateVersion).toBe(pausedVersion + 1)
    expect(game.pauseState).toBeUndefined()
    expect(harness.runtime.pendingTimerCount()).toBe(2)
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

  it('房主请求在最短展示期结束后返回等待并清理对局', () => {
    const { harness, host, room } = enterDrawing()
    harness.service.endEarly(host.playerId)
    room.members.forEach((member) => (member.ready = true))
    const resultVersion = room.stateVersion

    harness.service.returnWaiting(host.playerId)
    expect(room.phase).toBe('game_result')
    harness.runtime.advance(APP_CONFIG.game.gameResultMinSeconds * 1_000)

    expect(room.phase).toBe('waiting')
    expect(room.stateVersion).toBe(resultVersion + 2)
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
  it('服务端只有两个平级状态机可以直接赋值 phase（经典回合机 + 接龙状态机，S55）', () => {
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

    // 阶段写入的唯一归属是「模式状态机」：经典与接龙各一台、平级并存，
    // 其余模块（快照 / 装配 / 处理器）都不允许直接改房间阶段。
    expect(assignments).toEqual([
      { file: 'domain/relay/relay-machine.ts', statement: 'room.phase = next' },
      { file: 'round-machine.ts', statement: 'room.phase = next' },
    ])
  })
})

/** 接龙的五个专属阶段（S10 / S22 / S23）。 */
const RELAY_PHASES = [
  'relay_choose',
  'relay_draw',
  'relay_guess',
  'relay_showcase',
  'relay_vote',
] as const satisfies readonly RoomPhase[]

describe('接龙阶段转换白名单（S10 / S22 / S23 / S34）', () => {
  it('四步链的每条边都放行：选词 → 步1画 → 步2猜 → 步3画 → 步4猜 → 复盘 ⇄ 投票 → 终局', () => {
    const chain: Array<[RoomPhase, RoomPhase]> = [
      ['starting', 'relay_choose'],
      ['relay_choose', 'relay_draw'],
      ['relay_draw', 'relay_guess'],
      ['relay_guess', 'relay_draw'],
      ['relay_guess', 'relay_showcase'],
      ['relay_showcase', 'relay_vote'],
      ['relay_vote', 'relay_showcase'],
      ['relay_vote', 'game_result'],
      ['game_result', 'waiting'],
    ]
    for (const [from, to] of chain) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true)
    }
  })

  it('接龙不可暂停，也不允许跳步或越级进入复盘', () => {
    for (const phase of RELAY_PHASES) {
      expect(canTransition(phase, 'paused'), `${phase} → paused`).toBe(false)
      // 任何活跃阶段都必须能关闭房间（成员清空 / 房主解散）
      expect(canTransition(phase, 'closed'), `${phase} → closed`).toBe(true)
    }
    expect(canTransition('relay_choose', 'relay_guess')).toBe(false)
    expect(canTransition('relay_choose', 'relay_showcase')).toBe(false)
    expect(canTransition('relay_draw', 'relay_showcase')).toBe(false)
    expect(canTransition('relay_guess', 'relay_vote')).toBe(false)
    expect(canTransition('relay_vote', 'waiting')).toBe(false)
    // 任何接龙阶段都没有自环边：四步链严格递进（步 1 与步 3 共用 relay_draw 这个阶段名，
    // 但状态机从不把 relay_draw 写回 relay_draw）
    for (const phase of RELAY_PHASES)
      expect(canTransition(phase, phase), `${phase} → ${phase}`).toBe(false)
  })

  it('对局期（选词 / 作画 / 猜词）可提前结束；展示轮播期没有进终局的边（S34 / S12）', () => {
    for (const phase of ['relay_choose', 'relay_draw', 'relay_guess'] as const) {
      expect(canTransition(phase, 'game_result'), `${phase} → game_result`).toBe(true)
    }
    // 轮播期完全不可干预（无跳过、无提前结束）；投票期进终局是正常链路，是否放行「提前结束」由业务守卫裁决
    expect(canTransition('relay_showcase', 'game_result')).toBe(false)
    expect(canTransition('relay_showcase', 'waiting')).toBe(false)
    expect(canTransition('relay_vote', 'waiting')).toBe(false)
  })

  it('经典阶段不获得接龙边，接龙也不回经典对局阶段', () => {
    expect(canTransition('waiting', 'relay_choose')).toBe(false)
    expect(canTransition('choosing_word', 'relay_draw')).toBe(false)
    expect(canTransition('drawing', 'relay_guess')).toBe(false)
    expect(canTransition('round_result', 'relay_showcase')).toBe(false)
    expect(canTransition('relay_choose', 'choosing_word')).toBe(false)
    expect(canTransition('relay_draw', 'drawing')).toBe(false)
    expect(canTransition('relay_guess', 'round_result')).toBe(false)
    expect(canTransition('relay_showcase', 'round_result')).toBe(false)
    expect(canTransition('relay_vote', 'round_result')).toBe(false)
  })
})
