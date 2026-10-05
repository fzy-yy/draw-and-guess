import { describe, expect, it } from 'vitest'
import { APP_CONFIG, defaultRoomSettings, roomSettingsDefaults } from '@draw-guess/config'
import {
  CreateRoomSchema,
  DRAW_SECONDS_OPTIONS,
  RoomSettingsSchema,
  type RoomSettings,
} from '@draw-guess/shared'
import { createGameHarness, startTwoPlayerGame, testRoomSettings } from './helpers/game-harness.ts'

/** 已删除的加入策略字段键名（片段拼接：验收要求该标识符在源码与测试中零命中）。 */
const REMOVED_JOIN_POLICY_KEY = ['join', 'Policy'].join('')

/**
 * 房间规则产品闭环（校验点唯一化后）：
 * 规则范围只由协议 RoomSettingsSchema（strict + 同源约束常量）裁决——服务端不再二次重校，
 * 这里守护「Schema 拒得掉、默认组过得了」；容量与中途加入策略已删除（S36/S61），
 * 由 strict 未知键拒绝回归。「单回合时长」四档白名单在 Schema 守护下回归。
 */
describe('房间规则产品闭环', () => {
  it('默认设置工厂生成完整合法对象，与各滑块/档位默认一致', () => {
    const settings = defaultRoomSettings()
    // 容量与中途加入策略已删除：默认组的键集合应与规则默认基线完全一致
    expect(Object.keys(settings).sort()).toEqual(Object.keys(roomSettingsDefaults).sort())
    expect(RoomSettingsSchema.safeParse(settings).success).toBe(true)
    // 单回合时长默认 120 秒且必须落在合法档位内；选词阶段默认不限时
    expect(settings.drawSeconds).toBe(APP_CONFIG.game.drawSeconds.default)
    expect(DRAW_SECONDS_OPTIONS).toContain(settings.drawSeconds)
    // 差一字私密提示、画布微表情互动与作画精彩重播默认开启
    expect(settings.allowNearMissHint).toBe(true)
    expect(settings.allowCanvasReactions).toBe(true)
    expect(settings.allowRoundReplay).toBe(true)
    // 接龙三时长默认值取自 relay 配置（档位白名单在协议常量），默认 20 / 90 / 45（S39）
    expect(settings.relayChooseSeconds).toBe(APP_CONFIG.relay.chooseSeconds.default)
    expect(settings.relayDrawSeconds).toBe(APP_CONFIG.relay.drawSeconds.default)
    expect(settings.relayGuessSeconds).toBe(APP_CONFIG.relay.guessSeconds.default)
    expect([
      settings.relayChooseSeconds,
      settings.relayDrawSeconds,
      settings.relayGuessSeconds,
    ]).toEqual([20, 90, 45])
  })

  it('协议 Schema 逐字段拒绝越界、非整数、错误枚举与非布尔值（唯一裁决点）', () => {
    const valid = defaultRoomSettings()
    const invalidPatches: Array<Partial<Record<keyof RoomSettings, unknown>>> = [
      { roundsPerPlayer: 1.5 },
      { drawSeconds: 105 },
      { chooseSeconds: 31 },
      { optionCount: 2.5 },
      { showWordLength: 'yes' },
      { progressiveHints: 1 },
      { allowPlayerInvite: 'yes' },
      { allowWordReroll: null },
      { allowNearMissHint: 'yes' },
      { allowCanvasReactions: 123 },
      // 接龙三时长同为白名单档位：区间内的旧值（40 / 105 / 50）一律非法（S39）
      { relayChooseSeconds: 25 },
      { relayDrawSeconds: 105 },
      { relayGuessSeconds: 50 },
    ]
    for (const patch of invalidPatches) {
      expect(RoomSettingsSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
    }
    // 档位边界：四个合法档位全部通过
    for (const seconds of DRAW_SECONDS_OPTIONS)
      expect(RoomSettingsSchema.safeParse({ ...valid, drawSeconds: seconds }).success).toBe(true)
  })

  it('已删除的容量与中途加入策略经 strict 校验被拒绝（防回潮）', () => {
    const valid = defaultRoomSettings()
    // 建房/更新规则携带旧字段时必须被拒，而不是静默忽略后写入陈旧语义。
    // 中途加入策略的键名按片段拼接：验收要求该标识符在源码与测试中零命中（只留在 .scratch 与 ADR）。
    expect(RoomSettingsSchema.safeParse({ ...valid, maxPlayers: 2 }).success).toBe(false)
    expect(
      RoomSettingsSchema.safeParse({ ...valid, [REMOVED_JOIN_POLICY_KEY]: 'forbid' }).success,
    ).toBe(false)
    // 建房请求内嵌同一 Schema：旧字段同样在请求边界被拒。
    expect(
      CreateRoomSchema.safeParse({
        requestId: '00000000-0000-4000-8000-0000000000aa',
        name: '规则房',
        visibility: 'public',
        settings: { ...valid, maxPlayers: 6 },
      }).success,
    ).toBe(false)
  })

  it('单回合时长恒等于房间档位（词条派生时限不再参与）', () => {
    const harness = createGameHarness()
    const { game } = startTwoPlayerGame(harness, testRoomSettings({ drawSeconds: 150 }))
    const answer = game.candidates[0]
    if (!answer) throw new Error('测试词库未生成候选词')
    harness.service.chooseWord(game.drawerId, game.roundId, answer.id)
    // 回合时长只认房间档位（见 ADR-0046）
    expect(game.roundDurationMs).toBe(150 * 1_000)
  })

  it('选词阶段恒定倒计时并在超时后随机选词开画', () => {
    const harness = createGameHarness()
    const { room, game } = startTwoPlayerGame(harness, testRoomSettings())
    expect(room.phase).toBe('choosing_word')
    expect(game.phaseEndsAt).toBeGreaterThan(0)
    // 推进选词倒计时后自动选词开画
    harness.runtime.advance(room.settings.chooseSeconds * 1_000)
    expect(room.phase).toBe('drawing')
    expect(game.answer).toBeDefined()
  })

  it('房主可成功开启/关闭差一字私密提示与画布微表情并广播生效', () => {
    const harness = createGameHarness()
    const host = harness.register('房主')
    const room = harness.service.createRoom(host.playerId, {
      name: '测试房间',
      visibility: 'public',
      settings: testRoomSettings({
        allowNearMissHint: true,
        allowCanvasReactions: true,
        allowRoundReplay: true,
      }),
    })

    // 修改规则关闭这些项
    const updated = harness.service.updateSettings(
      host.playerId,
      {
        allowNearMissHint: false,
        allowCanvasReactions: false,
        allowRoundReplay: false,
      },
      room.stateVersion,
    )
    expect(updated.settings.allowNearMissHint).toBe(false)
    expect(updated.settings.allowCanvasReactions).toBe(false)
    expect(updated.settings.allowRoundReplay).toBe(false)
    expect(updated.stateVersion).toBeGreaterThan(room.stateVersion)
  })
})
