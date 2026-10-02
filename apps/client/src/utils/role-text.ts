/**
 * 成员局内角色文案的统一映射。
 * 玩家面板（PlayerPanel）与聊天区角色标签（ChatPanel）共用同一映射，保证两处展示一致；
 * 判断顺序对展示无歧义：画家/已猜中/观战等互斥，先判离场与画家即可。
 */
import { strings } from '@draw-guess/strings'
import type { RoomMember } from '@draw-guess/shared'

export function roleTextFor(member: RoomMember | undefined): string {
  if (!member) return strings.ui.status.roleGuessing
  if (member.leftGame) return strings.ui.status.roleLeftGame
  if (member.rematchReady) return strings.ui.status.roleRematchReady
  if (member.waitingForNextGame) return strings.ui.status.roleWaitingNextGame
  if (member.isDrawer) return strings.ui.status.roleDrawing
  if (member.guessed) return strings.ui.status.roleGuessed
  if (member.spectating) return strings.ui.status.roleSpectating
  return strings.ui.status.roleGuessing
}
