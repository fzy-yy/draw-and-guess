import type { z } from 'zod'
import type {
  MemberConnectionChangeSchema,
  PresenceSnapshotSchema,
  PublicRoomSchema,
  RoomCloseCodeSchema,
  RoomMemberSchema,
  RoomSnapshotSchema,
} from '../protocol/push.ts'
import type { RoomSettingsSchema } from '../protocol/room.ts'

/**
 * 房间规则设置：
 * 包含人数上限、回合轮数、单回合时长、选词时限、差一字私密提示与画布微表情开关等。
 */
export type RoomSettings = z.infer<typeof RoomSettingsSchema>
export type RoomMember = z.infer<typeof RoomMemberSchema>
export type PublicRoom = z.infer<typeof PublicRoomSchema>
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>
export type MemberConnectionChange = z.infer<typeof MemberConnectionChangeSchema>
export type PresenceSnapshot = z.infer<typeof PresenceSnapshotSchema>
export type RoomCloseCode = z.infer<typeof RoomCloseCodeSchema>
