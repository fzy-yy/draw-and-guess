/**
 * 终局荣誉称号推导规则纯函数单元测试。
 * 覆盖四项核心荣誉称号判定逻辑：
 * 1. 神笔马良：单回合被猜出速度最快（或被猜出率最高）的画家
 * 2. 灵魂画手：全场无人猜出次数最多、但画作笔画丰富的画家
 * 3. 读心大师：全场最快猜中（平均耗时最短）的猜词者
 * 4. 积极分子：全场发言猜测频次最高的气氛担当
 */
import { describe, expect, it } from 'vitest'
import type { GameView, RoomMember } from '@draw-guess/shared'
import { deriveAccolades } from '@/utils/accolades'

function createMember(
  id: string,
  nickname: string,
  statsPatch: Partial<RoomMember['stats']> = {},
): RoomMember {
  return {
    id,
    nickname,
    avatarId: '01',
    status: 'playing',
    seatIndex: 0,
    seatColor: '#dc2626',
    ready: true,
    score: 100,
    isHost: false,
    isDrawer: false,
    guessed: false,
    spectating: false,
    waitingForNextGame: false,
    rematchReady: false,
    leftGame: false,
    connection: 'online',
    stats: {
      correctCount: 0,
      totalGuessMs: 0,
      drawingCorrectCount: 0,
      ...statsPatch,
    },
  }
}

function createGameView(patch: Partial<GameView> = {}): GameView {
  return {
    gameId: '00000000-0000-4000-8000-000000000001',
    roundId: '00000000-0000-4000-8000-000000000002',
    currentRound: 1,
    totalRounds: 3,
    drawerId: 'p1',
    phaseStartedAt: 1000,
    phaseEndsAt: 70000,
    answerMask: '___',
    strokes: [],
    undoneStrokeIds: [],
    lastSequence: 0,
    drawingRevision: 1,
    messages: [],
    ...patch,
  }
}

describe('deriveAccolades 荣誉称号推导纯函数', () => {
  it('当数据为空或无输入时返回空集合', () => {
    expect(deriveAccolades(undefined, [])).toEqual({})
    const members = [createMember('p1', 'Alice')]
    const result = deriveAccolades(undefined, members)
    expect(result['p1']).toEqual([])
  })

  it('神笔马良：正确推导作画带猜中次数最多的画家', () => {
    const p1 = createMember('p1', 'Alice', { drawingCorrectCount: 5 })
    const p2 = createMember('p2', 'Bob', { drawingCorrectCount: 2 })
    const game = createGameView()

    const result = deriveAccolades(game, [p1, p2])
    expect(result['p1']?.some((a) => a.key === 'masterDrawer')).toBe(true)
    expect(result['p2']?.some((a) => a.key === 'masterDrawer')).toBe(false)
  })

  it('读心大师：正确推导平均猜词耗时最短的猜词者', () => {
    const p1 = createMember('p1', 'Alice', { correctCount: 2, totalGuessMs: 10000 }) // avg 5000ms
    const p2 = createMember('p2', 'Bob', { correctCount: 3, totalGuessMs: 6000 }) // avg 2000ms (最快)
    const game = createGameView()

    const result = deriveAccolades(game, [p1, p2])
    expect(result['p2']?.some((a) => a.key === 'mindReader')).toBe(true)
    expect(result['p1']?.some((a) => a.key === 'mindReader')).toBe(false)
  })

  it('积极分子：正确推导发言猜测频次最高的气氛担当', () => {
    const p1 = createMember('p1', 'Alice')
    const p2 = createMember('p2', 'Bob')
    const game = createGameView({
      messages: [
        { id: 'm1', type: 'guess', text: '苹果', playerId: 'p1', createdAt: 100 },
        { id: 'm2', type: 'guess', text: '香蕉', playerId: 'p1', createdAt: 200 },
        { id: 'm3', type: 'guess', text: '西瓜', playerId: 'p1', createdAt: 300 },
        { id: 'm4', type: 'guess', text: '橘子', playerId: 'p2', createdAt: 400 },
      ],
    })

    const result = deriveAccolades(game, [p1, p2])
    expect(result['p1']?.some((a) => a.key === 'activeGuesser')).toBe(true)
    expect(result['p2']?.some((a) => a.key === 'activeGuesser')).toBe(false)
  })

  it('灵魂画手：画作笔画丰富但本局带猜中为 0 的画家', () => {
    const p1 = createMember('p1', 'Alice', { drawingCorrectCount: 0 })
    const p2 = createMember('p2', 'Bob', { drawingCorrectCount: 3 })
    // strokes 数量大于等于 5
    const dummyStrokes = Array.from({ length: 8 }, (_, idx) => ({
      kind: 'stroke' as const,
      id: `s${idx}`,
      color: '#000000',
      width: 4,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
      sequence: idx,
      tool: 'pen' as const,
    }))
    const game = createGameView({ strokes: dummyStrokes })

    const result = deriveAccolades(game, [p1, p2])
    expect(result['p1']?.some((a) => a.key === 'soulPainter')).toBe(true)
  })

  it('所有荣誉称号元数据中的图标均为组件而非 emoji 字符串', () => {
    const p1 = createMember('p1', 'Alice', { drawingCorrectCount: 5 })
    const game = createGameView()
    const result = deriveAccolades(game, [p1])
    const masterDrawer = result['p1']?.find((a) => a.key === 'masterDrawer')
    expect(masterDrawer).toBeDefined()
    expect(typeof masterDrawer?.icon).not.toBe('string')
  })
})
