import { describe, expect, it } from 'vitest'
import { defaultRoomSettings } from '@draw-guess/config'
import {
  CLIENT_REQUEST_SCHEMAS,
  EVENTS,
  RoomSettingsSchema,
  UpdateRoomSettingsSchema,
  type RoomSettings,
} from '@draw-guess/shared'

/**
 * 规则补丁 schema 的回归（排查见 `.scratch/relay-mode/bug-report.md` B1）。
 *
 * 曾经的缺陷：`UpdateRoomSettingsSchema.patch` 写成 `RoomSettingsSchema.partial()`，而 Zod 4 的
 * `.partial()` 仍会给带 `.default()` 的字段补出默认值，于是**任何**补丁解析后都会多出
 * `allowNearMissHint` / `allowCanvasReactions` / `allowRoundReplay` 三个经典专属键；
 * 它们在接龙房不是生效键，被服务端模式白名单（S52）拒绝，导致接龙房**永远保存不了规则**。
 *
 * 这里刻意走 `CLIENT_REQUEST_SCHEMAS`（binder 实际使用的注册表）而不是直接调服务方法：
 * 原白名单用例绕过 schema parse，因此看不到注入。
 */
const requestId = '11111111-1111-4111-8111-111111111111'
const relayPatch = {
  relayChooseSeconds: 10,
  relayDrawSeconds: 60,
  relayGuessSeconds: 30,
  optionCount: 2,
  allowWordReroll: true,
  allowCustomWord: false,
  allowPlayerInvite: true,
} as const

describe('房间规则补丁 schema', () => {
  it('空补丁解析后不得补出任何键', () => {
    const parsed = UpdateRoomSettingsSchema.parse({ patch: {}, expectedVersion: 0, requestId })
    expect(Object.keys(parsed.patch)).toEqual([])
  })

  it('只保留调用方显式给出的键', () => {
    const parsed = UpdateRoomSettingsSchema.parse({
      patch: { relayDrawSeconds: 90 },
      expectedVersion: 0,
      requestId,
    })
    expect(Object.keys(parsed.patch)).toEqual(['relayDrawSeconds'])
  })

  it('请求注册表（binder 路径）解析后的键集合与送入时一致', () => {
    const schema = CLIENT_REQUEST_SCHEMAS[EVENTS.roomUpdateSettings]
    const parsed = schema.parse({ patch: { ...relayPatch }, expectedVersion: 1, requestId })
    expect(Object.keys(parsed.patch).sort()).toEqual(Object.keys(relayPatch).sort())
  })

  it('完整规则（建房）仍然按缺省补齐三个开关，行为不变', () => {
    const full: Record<string, unknown> = { ...defaultRoomSettings() }
    delete full.allowNearMissHint
    delete full.allowCanvasReactions
    delete full.allowRoundReplay
    const parsed = RoomSettingsSchema.parse(full)
    expect(parsed.allowNearMissHint).toBe(true)
    expect(parsed.allowCanvasReactions).toBe(true)
    expect(parsed.allowRoundReplay).toBe(true)
  })

  it('补丁 schema 与完整 schema 的字段集合完全一致', () => {
    const fullKeys = Object.keys(RoomSettingsSchema.shape).sort()
    const patchKeys = Object.keys(UpdateRoomSettingsSchema.shape.patch.shape).sort()
    expect(patchKeys).toEqual(fullKeys)
    // 类型层面同样锁定：两者都必须是 RoomSettings 的键集合。
    const keys: Array<keyof RoomSettings> = fullKeys as Array<keyof RoomSettings>
    expect(keys.length).toBe(fullKeys.length)
  })
})
