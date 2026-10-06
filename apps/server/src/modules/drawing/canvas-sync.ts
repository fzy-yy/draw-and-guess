/**
 * 画布差分同步游标管理（纯函数）。
 *
 * 遵循架构约定：
 * 维护每个成员接收到快照时的 lastSyncedSeq，
 * 用于增量快照计算与断线重连时的全量画布作废重同步。
 */
import type { MemberState, RoomSecret } from '../../models.ts'

type MemberList = Pick<RoomSecret, 'members'>

/**
 * 标记房间内全部成员的画布差分游标至当前序号。
 */
export function markAllSynced(room: MemberList, sequence: number): void {
  for (const member of room.members) {
    member.lastSyncedSeq = sequence
  }
}

/**
 * 作废房间内全部成员的画布差分游标（下一次快照将全量推送完整命令历史）。
 */
export function invalidateCanvasSync(room: MemberList): void {
  for (const member of room.members) {
    member.lastSyncedSeq = undefined
  }
}

/**
 * 作废指定单个成员的画布差分游标。
 */
export function invalidateMemberCanvasSync(member: MemberState): void {
  member.lastSyncedSeq = undefined
}
