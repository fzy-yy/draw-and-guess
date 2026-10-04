import { describe, expect, it } from 'vitest'
import { defaultRoomSettings } from '@draw-guess/config'
import { serverStrings } from '@draw-guess/strings'
import type { RoomSettings } from '@draw-guess/shared'
import { MODE_SETTINGS_KEYS } from '../../apps/server/src/game-service.ts'
import {
  MODE_SETTINGS_KEYS as CLIENT_MODE_SETTINGS_KEYS,
  scopeSettingsPatch,
} from '../../apps/client/src/utils/room-facts.ts'
import { GameError } from '../../apps/server/src/errors.ts'
import { createGameHarness, testRoomSettings, type GameHarness } from './helpers/game-harness.ts'

/**
 * 房间规则的模式白名单（S52 / S68）：
 * 服务端对当前模式不生效的字段**严格拒绝**（沿用既有 INVALID_SETTINGS 码与文案），
 * 共用字段两种模式都接受；模式 → 生效键名的唯一来源是 game-service.ts 的 MODE_SETTINGS_KEYS，
 * 客户端在 utils/room-facts.ts 按同一清单派生（两端清单不得漂移，见最后一个用例）。
 */

/** 经典专属字段（接龙下不生效）：每个键取一个与默认值不同的合法值。 */
const CLASSIC_ONLY_PATCHES: Array<Partial<RoomSettings>> = [
  { roundsPerPlayer: 3 },
  { drawSeconds: 60 },
  { chooseSeconds: 30 },
  { allowChooseTimeLimit: true },
  { showWordLength: false },
  { progressiveHints: false },
  { allowPause: false },
  { allowNearMissHint: false },
  { allowCanvasReactions: false },
  { allowRoundReplay: false },
]

/** 接龙专属字段（经典下不生效）。 */
const RELAY_ONLY_PATCHES: Array<Partial<RoomSettings>> = [
  { relayChooseSeconds: 15 },
  { relayDrawSeconds: 150 },
  { relayGuessSeconds: 75 },
]

/** 共用字段（两种模式都接受）：同样取与默认值不同的合法值。 */
const SHARED_PATCHES: Array<Partial<RoomSettings>> = [
  { optionCount: 5 },
  { allowWordReroll: false },
  { allowCustomWord: true },
  { allowPlayerInvite: false },
]

/** 捕获业务错误完整对象（用例要同时断言错误码与既有文案）。 */
function rejection(run: () => unknown): GameError {
  try {
    run()
  } catch (error) {
    if (error instanceof GameError) return error
    throw error
  }
  throw new Error('期望请求被拒绝，但没有抛出错误')
}

/** 建一个等待阶段的测试房（模式由用例指定），返回房主身份与房间秘密。 */
function createRoom(harness: GameHarness, gameMode: 'classic' | 'relay') {
  const host = harness.register('白名单房主')
  const snapshot = harness.service.createRoom(host.playerId, {
    name: '白名单测试房',
    visibility: 'public',
    gameMode,
    settings: testRoomSettings(),
  })
  const room = harness.service.rooms.get(snapshot.id)
  if (!room) throw new Error('测试房间未创建')
  return { host, room }
}

describe('房间规则模式白名单（S52）', () => {
  it('接龙房拒绝每一个经典专属字段，且不写入任何状态', () => {
    const harness = createGameHarness()
    const { host, room } = createRoom(harness, 'relay')
    const before = { ...room.settings }
    const versionBefore = room.stateVersion

    for (const patch of CLASSIC_ONLY_PATCHES) {
      const error = rejection(() =>
        harness.service.updateSettings(host.playerId, patch, room.stateVersion),
      )
      // 沿用既有错误码与既有文案，不为模式白名单新增码
      expect(error.code).toBe('INVALID_SETTINGS')
      expect(error.message).toBe(serverStrings.errors.INVALID_SETTINGS)
    }

    // 全部拒绝之后规则与版本号原样（拒绝路径不产生任何写入）
    expect(room.settings).toEqual(before)
    expect(room.stateVersion).toBe(versionBefore)
  })

  it('经典房拒绝每一个接龙专属字段，且不写入任何状态', () => {
    const harness = createGameHarness()
    const { host, room } = createRoom(harness, 'classic')
    const before = { ...room.settings }
    const versionBefore = room.stateVersion

    for (const patch of RELAY_ONLY_PATCHES) {
      const error = rejection(() =>
        harness.service.updateSettings(host.playerId, patch, room.stateVersion),
      )
      expect(error.code).toBe('INVALID_SETTINGS')
      expect(error.message).toBe(serverStrings.errors.INVALID_SETTINGS)
    }

    expect(room.settings).toEqual(before)
    expect(room.stateVersion).toBe(versionBefore)
  })

  it('共用字段在接龙房与经典房都接受并写入', () => {
    for (const gameMode of ['relay', 'classic'] as const) {
      const harness = createGameHarness()
      const { host, room } = createRoom(harness, gameMode)
      for (const patch of SHARED_PATCHES) {
        const versionBefore = room.stateVersion
        const updated = harness.service.updateSettings(host.playerId, patch, versionBefore)
        const key = Object.keys(patch)[0]! as keyof RoomSettings
        expect(updated.settings[key]).toBe(patch[key])
        expect(room.stateVersion).toBeGreaterThan(versionBefore)
      }
    }
  })

  it('接龙房接受三个接龙时长（逐个写入）', () => {
    const harness = createGameHarness()
    const { host, room } = createRoom(harness, 'relay')

    for (const patch of RELAY_ONLY_PATCHES) {
      const versionBefore = room.stateVersion
      const updated = harness.service.updateSettings(host.playerId, patch, versionBefore)
      const key = Object.keys(patch)[0]! as keyof RoomSettings
      expect(updated.settings[key]).toBe(patch[key])
    }
  })

  it('客户端按同一清单裁剪完整草稿：只保留该模式生效的键（值原样保留）', () => {
    // 规则弹窗回传完整草稿；上送前由 scopeSettingsPatch 裁剪，否则服务端必然拒绝（S52）
    const draft = defaultRoomSettings()
    const relayPatch = scopeSettingsPatch(draft, 'relay')
    expect(Object.keys(relayPatch).sort()).toEqual([...MODE_SETTINGS_KEYS.relay].sort())
    const classicPatch = scopeSettingsPatch(draft, 'classic')
    expect(Object.keys(classicPatch).sort()).toEqual([...MODE_SETTINGS_KEYS.classic].sort())

    // 裁剪只删键不改值
    expect(relayPatch.relayChooseSeconds).toBe(draft.relayChooseSeconds)
    expect(classicPatch.drawSeconds).toBe(draft.drawSeconds)
    expect('relayDrawSeconds' in classicPatch).toBe(false)
  })

  it('服务端与客户端的模式键集合清单完全一致（防两端各拍脑袋）', () => {
    const allKeys = Object.keys(defaultRoomSettings()).sort()
    for (const mode of ['classic', 'relay'] as const) {
      expect([...MODE_SETTINGS_KEYS[mode]].sort()).toEqual(
        [...CLIENT_MODE_SETTINGS_KEYS[mode]].sort(),
      )
      // 清单只能引用真实存在的规则键，且不得重复
      const keys = [...MODE_SETTINGS_KEYS[mode]]
      expect(new Set(keys).size).toBe(keys.length)
      for (const key of keys) expect(allKeys).toContain(key)
    }

    // 两个模式的清单互补且并集覆盖全部规则键：模式专属键各自只在一个清单里
    const classicKeys = new Set<string>(MODE_SETTINGS_KEYS.classic)
    const relayKeys = new Set<string>(MODE_SETTINGS_KEYS.relay)
    expect([...new Set([...classicKeys, ...relayKeys])].sort()).toEqual(allKeys)
    for (const patch of CLASSIC_ONLY_PATCHES) {
      const key = Object.keys(patch)[0]!
      expect(classicKeys.has(key)).toBe(true)
      expect(relayKeys.has(key)).toBe(false)
    }
    for (const patch of RELAY_ONLY_PATCHES) {
      const key = Object.keys(patch)[0]!
      expect(relayKeys.has(key)).toBe(true)
      expect(classicKeys.has(key)).toBe(false)
    }
    for (const patch of SHARED_PATCHES) {
      const key = Object.keys(patch)[0]!
      expect(classicKeys.has(key)).toBe(true)
      expect(relayKeys.has(key)).toBe(true)
    }
  })
})
