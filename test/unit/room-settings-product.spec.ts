import { describe, expect, it } from 'vitest'
import { APP_CONFIG, defaultRoomSettings, roomSettingsDefaults } from '@draw-guess/config'
import { DRAW_SECONDS_OPTIONS, RoomSettingsSchema, type RoomSettings } from '@draw-guess/shared'
import { createGameHarness, startTwoPlayerGame, testRoomSettings } from './helpers/game-harness.ts'

/**
 * 房间规则产品闭环（校验点唯一化后）：
 * 规则范围只由协议 RoomSettingsSchema（strict + 同源约束常量）裁决——服务端不再二次重校，
 * 这里守护「Schema 拒得掉、默认组过得了」；schema 给不了的领域判定（人数上限不得低于占席数）
 * 走真实用例断言。「单回合时长」四档白名单在 Schema 守护下回归。
 */
describe('房间规则产品闭环', () => {
  it('默认设置工厂生成完整合法对象，与各滑块/档位默认一致', () => {
    const settings = defaultRoomSettings(5)
    // 默认组不含 maxPlayers（由建房人数注入），键集合应恰为默认组 + maxPlayers
    expect(Object.keys(settings).sort()).toEqual(
      [...Object.keys(roomSettingsDefaults), 'maxPlayers'].sort(),
    )
    expect(RoomSettingsSchema.safeParse(settings).success).toBe(true)
    expect(settings.maxPlayers).toBe(5)
    // 单回合时长默认 120 秒且必须落在合法档位内；选词阶段默认不限时
    expect(settings.drawSeconds).toBe(APP_CONFIG.game.drawSeconds.default)
    expect(DRAW_SECONDS_OPTIONS).toContain(settings.drawSeconds)
    expect(settings.allowChooseTimeLimit).toBe(false)
  })

  it('协议 Schema 逐字段拒绝越界、非整数、错误枚举与非布尔值（唯一裁决点）', () => {
    const valid = defaultRoomSettings(6)
    const invalidPatches: Array<Partial<Record<keyof RoomSettings, unknown>>> = [
      { maxPlayers: 1 },
      { roundsPerPlayer: 1.5 },
      { drawSeconds: 105 },
      { chooseSeconds: 31 },
      { allowChooseTimeLimit: 'yes' },
      { optionCount: 2.5 },
      { showWordLength: 'yes' },
      { progressiveHints: 1 },
      { allowPlayerInvite: 'yes' },
      { allowPause: 1 },
      { allowWordReroll: null },
      { joinPolicy: 'open' },
    ]
    for (const patch of invalidPatches) {
      expect(RoomSettingsSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
    }
    // 档位边界：四个合法档位全部通过
    for (const seconds of DRAW_SECONDS_OPTIONS)
      expect(RoomSettingsSchema.safeParse({ ...valid, drawSeconds: seconds }).success).toBe(true)
  })

  it('人数上限不得低于当前占席成员数（Schema 给不了的房间态领域判定）', () => {
    const harness = createGameHarness()
    const host = harness.register('房主')
    const guest = harness.register('客人')
    const room = harness.service.createRoom(host.playerId, {
      name: '测试房间',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    const afterJoin = harness.service.joinRoom(guest.playerId, room.id)
    // 两人占席后把上限压到 1：必须被服务端权威拒绝
    expect(() =>
      harness.service.updateSettings(host.playerId, { maxPlayers: 1 }, afterJoin.stateVersion),
    ).toThrow()
    // 合法调整（保持占席数以内）应通过并推进状态版本（规则变更 + 准备态失效各推一次，只断言前进）
    const updated = harness.service.updateSettings(
      host.playerId,
      { maxPlayers: 2 },
      afterJoin.stateVersion,
    )
    expect(updated.settings.maxPlayers).toBe(2)
    expect(updated.stateVersion).toBeGreaterThan(afterJoin.stateVersion)
  })

  it('单回合时长恒等于房间档位（词条派生时限不再参与）', () => {
    const harness = createGameHarness()
    const { game } = startTwoPlayerGame(harness, testRoomSettings({ drawSeconds: 150 }))
    const answer = game.candidates[0]
    if (!answer) throw new Error('测试词库未生成候选词')
    harness.service.chooseWord(game.drawerId, game.roundId, answer.id)
    // 测试词库词条自带难度派生时限，但回合时长只认房间档位（见 ADR-0046）
    expect(game.roundDurationMs).toBe(150 * 1_000)
  })

  it('选词阶段关闭限时时没有截止时间，也不会自动代选', () => {
    const harness = createGameHarness()
    const { room, game } = startTwoPlayerGame(harness, testRoomSettings())
    expect(room.phase).toBe('choosing_word')
    // 0 是本项目「本阶段无截止时间」的哨兵
    expect(game.phaseEndsAt).toBe(0)
    // 推远超任何合理选词时限：没有计时器，阶段停在选词等待画家
    harness.runtime.advance(10 * 60 * 1_000)
    expect(room.phase).toBe('choosing_word')
  })

  it('无限时选词阶段暂停恢复后仍无限时', () => {
    const harness = createGameHarness()
    const { host, room, game } = startTwoPlayerGame(harness, testRoomSettings())
    harness.service.pause(host.playerId, '测试暂停')
    expect(room.phase).toBe('paused')
    harness.runtime.advance(30_000)
    harness.service.resume(host.playerId)
    expect(room.phase).toBe('choosing_word')
    expect(game.phaseEndsAt).toBe(0)
    harness.runtime.advance(60_000)
    expect(room.phase).toBe('choosing_word')
  })
})
