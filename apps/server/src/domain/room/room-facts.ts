/**
 * 房间事实：席位编号与阶段等价判定的纯函数（无时钟、无 IO、可独立单测）。
 *
 * 与成员事实（member-facts，ADR-0023）分治：那里裁决「成员处于什么状态」，
 * 这里裁决「房间处于什么阶段 / 席位如何编号」。此前这两种形状以字面量内联在
 * 离房/退局/断线保席/开局清理等 9 处调用点，语义相同表达各异——统一到这里。
 */
import type { RoomPhase } from '@draw-guess/shared'
import type { RoomSecret } from '../../models.ts'

/**
 * 房间是否处于目标名义阶段。
 * 房间未定义（可选链场景）一律 false。
 */
export function phaseEquivalent(room: RoomSecret | undefined, phase: RoomPhase): boolean {
  if (!room) return false
  return room.phase === phase
}

/**
 * 席位重排：seatIndex 与成员数组顺序保持紧凑一致。
 * 任何「成员数组变化且房间在等待阶段」的现场（离房、规则改人数、开局清理）都调用本函数，
 * 席位编号不得出现空洞或与数组顺序漂移。
 * 前置条件：仅 waiting 阶段调用——对局中重排会让席位颜色/条带与玩家身份错位。
 */
export function reseatMembers(room: RoomSecret): void {
  room.members.forEach((member, index) => {
    member.seatIndex = index
  })
}
