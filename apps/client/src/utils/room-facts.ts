/**
 * 房间客户端事实的单一具名口径（与服务端 `domain/room/member-facts.ts` 对齐）。
 *
 * 「可玩成员」判定与「玩家人数下拉选项」此前在 RoomView（allSet 与其模板内联重算）、
 * 建房弹窗与规则弹窗各写一遍；集中后改口径只需一处（见 docs/adr/0028-client-room-facts.md）。
 *
 * 注意：最终榜单的成员口径**不是**可玩成员——服务端榜单保留离局者（ADR-0023），
 * 因此榜单回退不使用 `activeMembers`。
 */
import { strings } from '@draw-guess/strings'
import type { RoomMember } from '@draw-guess/shared'

/** 可玩成员：非观战且未离局（与服务端 `isActivePlayer` 同口径）。 */
export function isActiveMember(member: RoomMember): boolean {
  return !member.spectating && !member.leftGame
}

/** 可玩成员集合。 */
export function activeMembers(members: readonly RoomMember[]): RoomMember[] {
  return members.filter(isActiveMember)
}

/**
 * 是否仍占席位：未主动离局（观战者仍占席，离局者为成绩卡保留的占位不再占席）。
 * 与服务端 `domain/room/member-facts.ts` 的 `occupiesSeat` 同口径——容量与房间规则里的
 * 「最大玩家数下限」都认它，不要改用 `activeMembers`（口径见 docs/adr/0023-member-facts-single-source.md）。
 */
export function occupiesSeatMember(member: RoomMember): boolean {
  return !member.leftGame
}

/**
 * 在线可玩身份：非观战且连接在线。
 * 用于「准备就绪」「可猜词」「可发送互动」这类要求当前身份即时在线的判定。
 * 与 `isActiveMember` 的差异：本谓词不排除 leftGame——调用点本身就是当前在线身份场景，
 * 离局占位成员是否需要排除由调用方按语义另行处理。
 */
export function isOnlineActiveMember(member: RoomMember): boolean {
  return !member.spectating && member.connection === 'online'
}

/** 玩家人数下拉选项（min..max 闭区间，文案经 strings.ui.common.playersUnit）。 */
export function playerCountOptions(range: { min: number; max: number }): Array<{
  value: number
  label: string
}> {
  const options: Array<{ value: number; label: string }> = []
  for (let count = range.min; count <= range.max; count += 1) {
    options.push({ value: count, label: strings.ui.common.playersUnit(count) })
  }
  return options
}
