import { describe, expect, it } from 'vitest'
import {
  APP_CONFIG,
  ROOM_PRESETS,
  ROOM_PRESET_IDS,
  applyRoomPreset,
  closestRoomPreset,
  createRoomSettings,
  matchingRoomPreset,
  roomPresetDifferences,
} from '@draw-guess/config'
import { RoomSettingsSchema, type RoomSettings } from '@draw-guess/shared'
import { createDefaultRoomSettings } from '../../apps/server/src/game-service.ts'
import { validateRoomSettings } from '../../apps/server/src/room-settings.ts'

describe('房间规则产品闭环', () => {
  it('标准、轻松、竞速预设都生成完整合法设置，并在切换时保持容量', () => {
    const keys = Object.keys(createDefaultRoomSettings()).sort()
    for (const preset of ROOM_PRESET_IDS) {
      const settings = createRoomSettings(preset, 5)
      expect(Object.keys(settings).sort()).toEqual(keys)
      expect(RoomSettingsSchema.safeParse(settings).success).toBe(true)
      expect(() => validateRoomSettings(settings)).not.toThrow()
      expect(settings.maxPlayers).toBe(5)
    }
    expect(createDefaultRoomSettings()).toEqual(
      createRoomSettings('standard', APP_CONFIG.player.defaultMaxPlayers),
    )
    expect(applyRoomPreset(createRoomSettings('relaxed', 4), 'speed')).toEqual({
      maxPlayers: 4,
      ...ROOM_PRESETS.speed,
    })
  })

  it('自定义规则稳定归入差异最少的预设，摘要差异只返回实际变化字段', () => {
    const relaxed = createRoomSettings('relaxed', 6)
    expect(closestRoomPreset(relaxed)).toBe('relaxed')
    expect(matchingRoomPreset(relaxed)).toBe('relaxed')
    expect(roomPresetDifferences(relaxed, 'relaxed')).toEqual([])
    const custom = { ...relaxed, allowPause: false, guessBaseScore: 350 }
    expect(closestRoomPreset(custom)).toBe('relaxed')
    expect(matchingRoomPreset(custom)).toBeUndefined()
    expect(roomPresetDifferences(custom, 'relaxed').sort()).toEqual([
      'allowPause',
      'guessBaseScore',
    ])
  })

  it('服务端逐字段拒绝越界、非整数、错误枚举与非布尔值', () => {
    const valid = createRoomSettings('standard', 6)
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
      { scoreMode: 'bonus' },
      { allowPlayerInvite: 'yes' },
      { allowPause: 1 },
      { allowWordReroll: null },
      { joinPolicy: 'open' },
    ]
    for (const patch of invalidPatches) {
      expect(() => validateRoomSettings({ ...valid, ...patch } as RoomSettings)).toThrow()
    }
  })
})
