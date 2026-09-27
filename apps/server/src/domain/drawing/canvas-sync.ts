/**
 * 画布差分同步游标（canvas sync cursor）的唯一口径。
 *
 * `member.lastSyncedSeq` 记录该成员最近一次收到快照时，画布已同步到的权威序号；
 * 服务端按它与 `game.lastSequence` 的差值只补发新增笔画（差分快照）。
 * 因此凡「整帧下发」（推进到当前序号）或「历史作废」（重置为 undefined）都必须经本模块，
 * 否则新回合/断线重连的首份快照可能被误判为「已同步」而省略整帧。
 *
 * 纯函数、只改游标不触碰其他状态（见根 CONTEXT.md「画布同步游标」）。
 */
import type { MemberState, RoomSecret } from '../../models.ts'

/** 只依赖成员列表的窄入参。 */
type MemberList = Pick<RoomSecret, 'members'>

/** 把房间内全部成员的画布差分游标推进到指定序号（权威整帧下发后调用）。 */
export function markAllSynced(room: MemberList, sequence: number): void {
  for (const member of room.members) member.lastSyncedSeq = sequence
}

/** 作废房间内全部成员的画布差分游标（新回合/历史变化后的首份快照必须整帧）。 */
export function invalidateCanvasSync(room: MemberList): void {
  for (const member of room.members) member.lastSyncedSeq = undefined
}

/** 作废单个成员的画布差分游标（该成员断线重连等需整帧重同步时调用）。 */
export function invalidateMemberCanvasSync(member: MemberState): void {
  member.lastSyncedSeq = undefined
}
