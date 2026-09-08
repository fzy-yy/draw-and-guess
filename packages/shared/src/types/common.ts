import type { z } from 'zod'
import type { ProfileSchema, RoomPhaseSchema } from '../protocol/base.ts'
import type {
  ConnectionStateSchema,
  PresenceStatusSchema,
  PublicPlayerSchema,
} from '../protocol/push.ts'
import type { RoomVisibilitySchema } from '../protocol/room.ts'
import type { RegisterSchema } from '../protocol/session.ts'

export type RoomPhase = z.infer<typeof RoomPhaseSchema>
export type ConnectionState = z.infer<typeof ConnectionStateSchema>
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>
export type RoomVisibility = z.infer<typeof RoomVisibilitySchema>
export type Profile = z.infer<typeof ProfileSchema>
export type AvatarId = Profile['avatarId']
export type PublicPlayer = z.infer<typeof PublicPlayerSchema>

/** 画板 UI 工具联合；线上 stroke/fill 载荷分别由对应 Schema 推导。 */
export type ToolKind = 'pen' | 'eraser' | 'fill'

export type PresencePreferences = z.infer<typeof RegisterSchema>['preferences']

export type Ack<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string }; requestId: string }
