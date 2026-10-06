import { describe, expect, it } from 'vitest'
import {
  activeGuessers,
  activePlayers,
  connectionStatus,
  createEmptyMemberStats,
  createOnlineLookup,
  isActivePlayer,
  isOnlinePlayer,
  isPhaseExpired,
  nicknameOf,
  occupiesSeat,
} from '../../apps/server/src/domain/room/member-facts.ts'
import type { MemberState, PlayerSecret } from '../../apps/server/src/models.ts'

/** 构造一名最小成员；只覆盖被测字段，其余取默认值。 */
function member(overrides: Partial<MemberState> = {}): MemberState {
  const playerId = overrides.playerId ?? 'p'
  return {
    playerId,
    seatIndex: 0,
    ready: false,
    score: 0,
    joinedAt: 0,
    stats: { correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 },
    ...overrides,
  }
}

/** 构造一个只含 members 的房间入参（选择器与计数只需要它）。 */
function room(...members: MemberState[]): { members: MemberState[] } {
  return { members }
}

/** 指定哪些玩家在线。 */
function online(...playerIds: string[]): (playerId: string) => boolean {
  const set = new Set(playerIds)
  return (playerId) => set.has(playerId)
}

describe('member-facts 谓词契约', () => {
  it('occupiesSeat 只看是否离局', () => {
    expect(occupiesSeat(member())).toBe(true)
    expect(occupiesSeat(member({ leftGame: true }))).toBe(false)
  })

  it('isActivePlayer 只排除离局者', () => {
    expect(isActivePlayer(member())).toBe(true)
    expect(isActivePlayer(member({ leftGame: true }))).toBe(false)
  })

  it('isOnlinePlayer 在可玩基础上要求在线', () => {
    const onlineAll = online('p')
    expect(isOnlinePlayer(member(), onlineAll)).toBe(true)
    expect(isOnlinePlayer(member(), online())).toBe(false)
    // 离局者即便玩家仍在线也不算在线可玩
    expect(isOnlinePlayer(member({ leftGame: true }), onlineAll)).toBe(false)
  })

  it('connectionStatus 区分 left / online / reconnecting', () => {
    expect(connectionStatus(member(), { connected: true })).toBe('online')
    expect(connectionStatus(member(), { connected: false })).toBe('reconnecting')
    expect(connectionStatus(member(), undefined)).toBe('left')
    expect(connectionStatus(member({ leftGame: true }), { connected: true })).toBe('left')
  })
})

describe('member-facts 选择器与计数契约', () => {
  const active = member({ playerId: 'active' })
  const away = member({ playerId: 'away' })
  const departed = member({ playerId: 'departed', leftGame: true })
  const parties = [active, away, departed]

  it('activePlayers 只取可玩成员', () => {
    expect(activePlayers(room(...parties)).map((m) => m.playerId)).toEqual(['active', 'away'])
  })

  it('activeGuessers 排除画家与离局者，保留掉线者', () => {
    const guessers = activeGuessers(room(...parties), 'active')
    expect(guessers.map((m) => m.playerId)).toEqual(['away'])
    expect(activeGuessers(room(...parties), 'drawer').map((m) => m.playerId)).toEqual([
      'active',
      'away',
    ])
  })
})

describe('createEmptyMemberStats 契约', () => {
  it('返回全零统计，且每次调用返回独立对象（防共享可变状态）', () => {
    const first = createEmptyMemberStats()
    const second = createEmptyMemberStats()
    expect(first).toEqual({ correctCount: 0, totalGuessMs: 0, drawingCorrectCount: 0 })
    expect(first).not.toBe(second)
  })
})

describe('member-facts 纯函数契约', () => {
  it('不修改传入的成员与房间', () => {
    const memberList = [member({ playerId: 'a' }), member({ playerId: 'b', leftGame: true })]
    const input = room(...memberList)
    const before = structuredClone(input)
    activePlayers(input)
    activeGuessers(input, 'a')
    expect(input).toEqual(before)
  })
})

describe('member-facts 同构判定单一口径', () => {
  it('createOnlineLookup 只在玩家存在且 connected 为 true 时判为在线', () => {
    const players = new Map([
      ['a', { connected: true }],
      ['b', { connected: false }],
    ])
    const isOnline = createOnlineLookup(players)
    expect(isOnline('a')).toBe(true)
    expect(isOnline('b')).toBe(false)
    expect(isOnline('missing')).toBe(false)
  })

  it('isPhaseExpired 把 phaseEndsAt=0 视为未到期（无截止时间哨兵）', () => {
    expect(isPhaseExpired({ phaseEndsAt: 0 }, 1_000)).toBe(false)
    expect(isPhaseExpired({ phaseEndsAt: 999 }, 1_000)).toBe(true)
    expect(isPhaseExpired({ phaseEndsAt: 1_000 }, 1_000)).toBe(true)
    expect(isPhaseExpired({ phaseEndsAt: 1_001 }, 1_000)).toBe(false)
  })

  it('nicknameOf 读取昵称并在身份缺失时回退调用方文案', () => {
    const players = new Map<string, Pick<PlayerSecret, 'profile'>>([
      ['a', { profile: { nickname: '画家' } as PlayerSecret['profile'] }],
    ])
    expect(nicknameOf(players, 'a', '兜底')).toBe('画家')
    expect(nicknameOf(players, 'missing', '兜底')).toBe('兜底')
  })
})
