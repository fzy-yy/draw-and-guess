/**
 * 成员局内角色文案的统一映射。
 * 得分条（ScoreStrip）与聊天区角色标签（ChatPanel）共用同一映射，保证两处展示一致；
 * 判断顺序对展示无歧义：画家/已猜中/观战等互斥，先判离场与画家即可。
 */
import { strings } from '@draw-guess/strings'
import type { RoomMember } from '@draw-guess/shared'

export function roleTextFor(member: RoomMember | undefined): string {
  if (!member) return strings.status.roleGuessing
  if (member.leftGame) return strings.status.roleLeftGame
  if (member.rematchReady) return strings.status.roleRematchReady
  if (member.waitingForNextGame) return strings.status.roleWaitingNextGame
  if (member.isDrawer) return strings.status.roleDrawing
  if (member.guessed) return strings.status.roleGuessed
  if (member.spectating) return strings.status.roleSpectating
  return strings.status.roleGuessing
}
