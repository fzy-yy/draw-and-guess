import type { z } from 'zod'
import type {
  MemberConnectionChangeSchema,
  PresenceSnapshotSchema,
  PublicRoomSchema,
  RoomMemberSchema,
  RoomSnapshotSchema,
} from '../protocol/push.ts'
import type { RoomSettingsSchema } from '../protocol/room.ts'

export type RoomSettings = z.infer<typeof RoomSettingsSchema>
export type RoomMember = z.infer<typeof RoomMemberSchema>
export type PublicRoom = z.infer<typeof PublicRoomSchema>
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>
export type MemberConnectionChange = z.infer<typeof MemberConnectionChangeSchema>
export type PresenceSnapshot = z.infer<typeof PresenceSnapshotSchema>
