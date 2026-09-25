import { describe, expect, it } from 'vitest'
import { APP_CONFIG, defaultRoomSettings, roomSettingsDefaults } from '@draw-guess/config'
import { RoomSettingsSchema, type RoomSettings } from '@draw-guess/shared'
import { createDefaultRoomSettings } from '../../apps/server/src/game-service.ts'
import { validateRoomSettings } from '../../apps/server/src/room-settings.ts'
import { createGameHarness, startTwoPlayerGame, testRoomSettings } from './helpers/game-harness.ts'

/**
 * 房间规则产品闭环（旧「玩法预设」三档映射已移除）：
 * 唯一默认组、服务端默认工厂、协议 Schema 与服务端逐字段校验必须口径一致；
 * 「额外猜词时间」为新增规则项，边界（0~90、整数）在此守护。
 */
describe('房间规则产品闭环', () => {
  it('默认设置工厂生成完整合法对象，服务端默认与配置基线一致', () => {
    const settings = defaultRoomSettings(5)
    expect(Object.keys(settings).sort()).toEqual(Object.keys(createDefaultRoomSettings()).sort())
    expect(RoomSettingsSchema.safeParse(settings).success).toBe(true)
    expect(() => validateRoomSettings(settings)).not.toThrow()
    expect(settings.maxPlayers).toBe(5)
    expect(createDefaultRoomSettings()).toEqual(
      defaultRoomSettings(APP_CONFIG.player.defaultMaxPlayers),
    )
    // 额外猜词时间默认 0（不额外增加），且与滑块区间默认一致
    expect(settings.extraGuessSeconds).toBe(0)
    expect(roomSettingsDefaults.extraGuessSeconds).toBe(APP_CONFIG.game.extraGuessSeconds.default)
  })

  it('服务端逐字段拒绝越界、非整数、错误枚举与非布尔值', () => {
    const valid = defaultRoomSettings(6)
    const invalidPatches: Array<Partial<Record<keyof RoomSettings, unknown>>> = [
      { maxPlayers: 1 },
      { roundsPerPlayer: 1.5 },
      { drawSeconds: 44 },
      { chooseSeconds: 31 },
      { optionCount: 2.5 },
      { showWordLength: 'yes' },
      { progressiveHints: 1 },
      { structuredHintsEnabled: null },
      { hintStartRatio: 0.95 },
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
      expect(() => validateRoomSettings({ ...valid, ...patch } as RoomSettings)).toThrow()
    }
    // 边界合法值：0 与 90 都必须通过
    expect(() => validateRoomSettings({ ...valid, extraGuessSeconds: 0 })).not.toThrow()
    expect(() => validateRoomSettings({ ...valid, extraGuessSeconds: 90 })).not.toThrow()
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
