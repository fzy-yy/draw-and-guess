import { describe, expect, it } from 'vitest'
import { APP_CONFIG, defaultRoomSettings, roomSettingsDefaults } from '@draw-guess/config'
import { RoomSettingsSchema, type RoomSettings } from '@draw-guess/shared'
import { createGameHarness, startTwoPlayerGame, testRoomSettings } from './helpers/game-harness.ts'

/**
 * 房间规则产品闭环（校验点唯一化后）：
 * 规则范围只由协议 RoomSettingsSchema（strict + 同源约束常量）裁决——服务端不再二次重校，
 * 这里守护「Schema 拒得掉、默认组过得了」；schema 给不了的领域判定（人数上限不得低于占席数）
 * 走真实用例断言。「额外猜词时间」边界（0~90、整数）在 Schema 守护下回归。
 */
describe('房间规则产品闭环', () => {
  it('默认设置工厂生成完整合法对象，与各滑块/区间默认一致', () => {
    const settings = defaultRoomSettings(5)
    // 默认组不含 maxPlayers（由建房人数注入），键集合应恰为默认组 + maxPlayers
    expect(Object.keys(settings).sort()).toEqual(
      [...Object.keys(roomSettingsDefaults), 'maxPlayers'].sort(),
    )
    expect(RoomSettingsSchema.safeParse(settings).success).toBe(true)
    expect(settings.maxPlayers).toBe(5)
    // 额外猜词时间默认 0（不额外增加），且与滑块区间默认一致
    expect(settings.extraGuessSeconds).toBe(0)
    expect(roomSettingsDefaults.extraGuessSeconds).toBe(APP_CONFIG.game.extraGuessSeconds.default)
  })

  it('协议 Schema 逐字段拒绝越界、非整数、错误枚举与非布尔值（唯一裁决点）', () => {
    const valid = defaultRoomSettings(6)
    const invalidPatches: Array<Partial<Record<keyof RoomSettings, unknown>>> = [
      { maxPlayers: 1 },
      { roundsPerPlayer: 1.5 },
      { drawSeconds: 44 },
      { chooseSeconds: 31 },
      { optionCount: 2.5 },
      { showWordLength: 'yes' },
      { progressiveHints: 1 },
      { guessBaseScore: 25 },
      { extraGuessSeconds: -5 },
      { extraGuessSeconds: 91 },
      { extraGuessSeconds: 7.5 },
      { allowPlayerInvite: 'yes' },
      { allowPause: 1 },
      { allowWordReroll: null },
      { joinPolicy: 'open' },
    ]
    for (const patch of invalidPatches) {
      expect(RoomSettingsSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
    }
    // 边界合法值：0 与 90 都必须通过
    expect(RoomSettingsSchema.safeParse({ ...valid, extraGuessSeconds: 0 }).success).toBe(true)
    expect(RoomSettingsSchema.safeParse({ ...valid, extraGuessSeconds: 90 }).success).toBe(true)
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

  it('额外猜词时间叠加到回合时限（在难度派生时限之上）', () => {
    const harness = createGameHarness()
    // drawSeconds 取 45：开局默认时长为 (45+30)s，与「词条时限 90 + 30」可区分，
    // 断言 beginDrawing 真正按词条时限叠加了额外时间
    const { game } = startTwoPlayerGame(
      harness,
      testRoomSettings({ extraGuessSeconds: 30, drawSeconds: 45 }),
    )
    const answer = game.candidates[0]
    if (!answer) throw new Error('测试词库未生成候选词')
    harness.service.chooseWord(game.drawerId, game.roundId, answer.id)
    // 测试词库全部词条 timeLimit=90；额外 30 秒 → 回合时长 120 秒
    expect(game.roundDurationMs).toBe((90 + 30) * 1_000)
  })
})
