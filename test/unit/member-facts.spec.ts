import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import {
  activeGuessers,
  activePlayers,
  connectionStatus,
  countActivePlayers,
  countOnlinePlayers,
  createEmptyMemberStats,
  createOnlineLookup,
  isActivePlayer,
  isOnlinePlayer,
  isPhaseExpired,
  isRankedMember,
  isRematchEligible,
  nicknameOf,
  nominalPhaseDurationMs,
  occupiesSeat,
  onlineGuessers,
  onlinePlayers,
  rankedMembers,
  rematchEligibleMembers,
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
  it('occupiesSeat 只看是否离局，观战仍占席', () => {
    expect(occupiesSeat(member())).toBe(true)
    expect(occupiesSeat(member({ spectating: true }))).toBe(true)
    expect(occupiesSeat(member({ leftGame: true }))).toBe(false)
  })

  it('isActivePlayer 同时排除观战与离局', () => {
    expect(isActivePlayer(member())).toBe(true)
    expect(isActivePlayer(member({ spectating: true }))).toBe(false)
    expect(isActivePlayer(member({ leftGame: true }))).toBe(false)
    expect(isActivePlayer(member({ spectating: true, leftGame: true }))).toBe(false)
  })

  it('isOnlinePlayer 在可玩基础上要求在线', () => {
    const onlineAll = online('p')
    expect(isOnlinePlayer(member(), onlineAll)).toBe(true)
    expect(isOnlinePlayer(member(), online())).toBe(false)
    // 离局或观战即便玩家仍在线也不算在线可玩
    expect(isOnlinePlayer(member({ leftGame: true }), onlineAll)).toBe(false)
    expect(isOnlinePlayer(member({ spectating: true }), onlineAll)).toBe(false)
  })

  it('isRematchEligible 认候场、排除纯观战与离局', () => {
    expect(isRematchEligible(member())).toBe(true)
    expect(isRematchEligible(member({ spectating: true, waitingForNextGame: true }))).toBe(true)
    expect(isRematchEligible(member({ spectating: true }))).toBe(false)
    expect(isRematchEligible(member({ leftGame: true }))).toBe(false)
    // 离局者即便登记过候场也不再有效
    expect(isRematchEligible(member({ leftGame: true, waitingForNextGame: true }))).toBe(false)
  })

  it('isRankedMember 排除观战但保留离局者', () => {
    expect(isRankedMember(member())).toBe(true)
    expect(isRankedMember(member({ leftGame: true }))).toBe(true)
    expect(isRankedMember(member({ spectating: true }))).toBe(false)
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
  const spectator = member({ playerId: 'spectator', spectating: true })
  const nextGame = member({ playerId: 'next', spectating: true, waitingForNextGame: true })
  const departed = member({ playerId: 'departed', leftGame: true })
  const parties = [active, spectator, nextGame, departed]

  it('activePlayers / countActivePlayers 只取可玩成员', () => {
    expect(activePlayers(room(...parties)).map((m) => m.playerId)).toEqual(['active'])
    expect(countActivePlayers(room(...parties))).toBe(1)
  })

  it('onlinePlayers / countOnlinePlayers 在可玩基础上过滤在线', () => {
    const isOnline = online('active', 'spectator')
    expect(onlinePlayers(room(...parties), isOnline).map((m) => m.playerId)).toEqual(['active'])
    expect(countOnlinePlayers(room(...parties), isOnline)).toBe(1)
  })

  it('rematchEligibleMembers 含可玩与候场、排除纯观战与离局', () => {
    expect(rematchEligibleMembers(room(...parties)).map((m) => m.playerId)).toEqual([
      'active',
      'next',
    ])
  })

  it('rankedMembers 保留离局者、排除观战者', () => {
    expect(rankedMembers(room(...parties)).map((m) => m.playerId)).toEqual(['active', 'departed'])
  })

  it('activeGuessers 排除画家与观战/离局，保留掉线者', () => {
    const guessers = activeGuessers(room(...parties), 'active')
    expect(guessers.map((m) => m.playerId)).toEqual([])
    expect(activeGuessers(room(...parties), 'drawer').map((m) => m.playerId)).toEqual(['active'])
  })

  it('onlineGuessers 在 activeGuessers 基础上只留在线的', () => {
    const drawRoom = room(active, spectator, departed, member({ playerId: 'away' }))
    expect(onlineGuessers(drawRoom, 'drawer', online('active')).map((m) => m.playerId)).toEqual([
      'active',
    ])
  })
})

describe('nominalPhaseDurationMs 契约', () => {
  const game = { roundDurationMs: 45_000 }
  const settings = { chooseSeconds: 12, allowChooseTimeLimit: true, allowRoundReplay: false }
  it('drawing 返回本回合实际作画时长', () => {
    expect(nominalPhaseDurationMs('drawing', game, settings)).toBe(45_000)
  })

  it('choosing_word 返回房间选词秒数换算的毫秒', () => {
    expect(nominalPhaseDurationMs('choosing_word', game, settings)).toBe(12_000)
  })

  it('选词阶段关闭限时时没有标称总时长（调用方据此保持无截止时间哨兵）', () => {
    expect(
      nominalPhaseDurationMs('choosing_word', game, {
        chooseSeconds: 12,
        allowChooseTimeLimit: false,
      }),
    ).toBeUndefined()
  })

  it('round_result 返回全局结算展示时长（包含开启重播时的 3 秒与关闭时的 5 秒）', () => {
    expect(
      nominalPhaseDurationMs('round_result', game, { ...settings, allowRoundReplay: false }),
    ).toBe(APP_CONFIG.game.roundResultSeconds * 1_000)
    expect(
      nominalPhaseDurationMs('round_result', game, { ...settings, allowRoundReplay: true }),
    ).toBe(
      (APP_CONFIG.game.roundReplaySeconds +
        APP_CONFIG.game.roundReplayPauseSeconds +
        APP_CONFIG.game.roundResultSeconds) *
        1_000,
    )
  })

  it('不可暂停阶段与阶段缺失返回 undefined', () => {
    expect(nominalPhaseDurationMs('game_result', game, settings)).toBeUndefined()
    expect(nominalPhaseDurationMs('starting', game, settings)).toBeUndefined()
    // 暂停现场缺失（pauseState 为 undefined）同样返回 undefined
    expect(nominalPhaseDurationMs(undefined, game, settings)).toBeUndefined()
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
    const memberList = [member({ playerId: 'a' }), member({ playerId: 'b', spectating: true })]
    const input = room(...memberList)
    const before = structuredClone(input)
    activePlayers(input)
    onlinePlayers(input, online('a'))
    rematchEligibleMembers(input)
    rankedMembers(input)
    activeGuessers(input, 'a')
    onlineGuessers(input, 'a', online('a'))
    countActivePlayers(input)
    countOnlinePlayers(input, online('a'))
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

  it('isPhaseExpired 把 phaseEndsAt=0 视为未到期（暂停期哨兵）', () => {
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
