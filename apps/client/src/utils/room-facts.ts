/**
 * 房间客户端事实的单一具名口径（与服务端 `domain/room/member-facts.ts` 对齐）。
 *
 * 「可玩成员」判定此前在 RoomView、建房弹窗与规则弹窗各写一遍；集中后改口径只需一处
 *（见 docs/adr/0028-client-room-facts.md）。
 *
 * 注意：最终榜单的成员口径**不是**可玩成员——服务端榜单保留离局者（ADR-0023），
 * 因此榜单回退不使用 `activeMembers`。
 */
import {
  DEFAULT_GAME_MODE,
  MODE_SETTINGS_KEYS,
  type GameMode,
  type RoomMember,
  type RoomSettings,
} from '@draw-guess/shared'

/**
 * 模式 → 生效的规则键名直接来自共享协议层（唯一来源）。
 *
 * 用途：规则弹窗据此决定渲染哪些字段、`updateRoomSettings` 据此把完整草稿裁剪成当前模式生效的补丁
 * ——服务端会严格拒绝出现不生效键的补丁（S52），不裁剪的完整草稿必然被拒。
 * 本文件不再维护镜像副本（见 docs/adr/0064-single-backend-assembly.md）。
 */

/** 取某模式生效的规则键名（缺省按协议默认模式，用于尚未装配房间快照的调用点）。 */
function modeSettingsKeys(gameMode: GameMode | undefined): readonly (keyof RoomSettings)[] {
  return MODE_SETTINGS_KEYS[gameMode ?? DEFAULT_GAME_MODE]
}

/**
 * 按模式裁剪规则补丁：只保留该模式生效的键。
 * 规则弹窗回传的是完整草稿（含全部字段），而服务端按模式白名单严格拒绝不生效键（S52），
 * 因此发送前必须过这一层；逐键赋值保持键与值的一一对应，不使用 `any` 或非空断言。
 */
export function scopeSettingsPatch(
  patch: Partial<RoomSettings>,
  gameMode: GameMode | undefined,
): Partial<RoomSettings> {
  const scoped: Partial<RoomSettings> = {}
  for (const key of modeSettingsKeys(gameMode)) {
    const value = patch[key]
    if (value !== undefined) Object.assign(scoped, { [key]: value })
  }
  return scoped
}

/** 可玩成员：未离局（与服务端 `isActivePlayer` 同口径；观战与候场已删除）。 */
export function isActiveMember(member: RoomMember): boolean {
  return !member.leftGame
}

/** 可玩成员集合。 */
export function activeMembers(members: readonly RoomMember[]): RoomMember[] {
  return members.filter(isActiveMember)
}

/**
 * 是否仍占席位：未主动离局。
 * 与服务端 `domain/room/member-facts.ts` 的 `occupiesSeat` 同口径——容量与大厅人数都认它，
 * 不要改用 `activeMembers`（口径见 docs/adr/0023-member-facts-single-source.md）。
 */
export function occupiesSeatMember(member: RoomMember): boolean {
  return !member.leftGame
}

/**
 * 在线可玩身份：连接在线（未离局占位由调用方按语义另行排除）。
 * 用于「准备就绪」「可猜词」「可发送互动」这类要求当前身份即时在线的判定。
 */
export function isOnlineActiveMember(member: RoomMember): boolean {
  return member.connection === 'online'
}
