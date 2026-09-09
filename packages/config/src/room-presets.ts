import type { RoomSettings } from '@draw-guess/shared'

export const ROOM_PRESET_IDS = ['standard', 'relaxed', 'speed'] as const
export type RoomPresetId = (typeof ROOM_PRESET_IDS)[number]
export type RoomPresetSettings = Omit<RoomSettings, 'maxPlayers'>
export type RoomPresetField = keyof RoomPresetSettings

/** 三档产品预设是完整规则映射；容量独立于玩法，切换预设时保持当前 maxPlayers。 */
export const ROOM_PRESETS = {
  standard: {
    roundsPerPlayer: 2,
    drawSeconds: 90,
    chooseSeconds: 15,
    optionCount: 3,
    showWordLength: true,
    progressiveHints: true,
    structuredHintsEnabled: true,
    hintStartRatio: 0.35,
    guessBaseScore: 300,
    scoreMode: 'standard',
    allowPlayerInvite: true,
    allowPause: true,
    allowWordReroll: true,
    joinPolicy: 'next_game',
  },
  relaxed: {
    roundsPerPlayer: 2,
    drawSeconds: 120,
    chooseSeconds: 25,
    optionCount: 4,
    showWordLength: true,
    progressiveHints: true,
    structuredHintsEnabled: true,
    hintStartRatio: 0.55,
    guessBaseScore: 300,
    scoreMode: 'flat',
    allowPlayerInvite: true,
    allowPause: true,
    allowWordReroll: true,
    joinPolicy: 'spectate',
  },
  speed: {
    roundsPerPlayer: 1,
    drawSeconds: 45,
    chooseSeconds: 10,
    optionCount: 2,
    showWordLength: false,
    progressiveHints: false,
    structuredHintsEnabled: false,
    hintStartRatio: 0.2,
    guessBaseScore: 500,
    scoreMode: 'standard',
    allowPlayerInvite: false,
    allowPause: false,
    allowWordReroll: false,
    joinPolicy: 'forbid',
  },
} as const satisfies Record<RoomPresetId, RoomPresetSettings>

export function applyRoomPreset(settings: RoomSettings, preset: RoomPresetId): RoomSettings {
  return { maxPlayers: settings.maxPlayers, ...ROOM_PRESETS[preset] }
}

export function createRoomSettings(preset: RoomPresetId, maxPlayers: number): RoomSettings {
  return { maxPlayers, ...ROOM_PRESETS[preset] }
}

export function roomPresetDifferences(
  settings: RoomSettings,
  preset: RoomPresetId,
): RoomPresetField[] {
  const baseline = ROOM_PRESETS[preset]
  return (Object.keys(baseline) as RoomPresetField[]).filter(
    (field) => settings[field] !== baseline[field],
  )
}

export function matchingRoomPreset(settings: RoomSettings): RoomPresetId | undefined {
  return ROOM_PRESET_IDS.find((preset) => roomPresetDifferences(settings, preset).length === 0)
}

/** 自定义规则归入差异最少的预设；平局按 standard → relaxed → speed 稳定选择。 */
export function closestRoomPreset(settings: RoomSettings): RoomPresetId {
  return ROOM_PRESET_IDS.reduce((closest, candidate) =>
    roomPresetDifferences(settings, candidate).length <
    roomPresetDifferences(settings, closest).length
      ? candidate
      : closest,
  )
}
