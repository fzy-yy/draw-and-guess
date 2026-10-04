/**
 * 房间客户端事实的单一具名口径（与服务端 `domain/room/member-facts.ts` 对齐）。
 *
 * 「可玩成员」判定此前在 RoomView、建房弹窗与规则弹窗各写一遍；集中后改口径只需一处
 *（见 docs/adr/0028-client-room-facts.md）。
 *
 * 注意：最终榜单的成员口径**不是**可玩成员——服务端榜单保留离局者（ADR-0023），
 * 因此榜单回退不使用 `activeMembers`。
 */
import type { RoomMember } from '@draw-guess/shared'

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
