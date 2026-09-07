export type RoomPhase =
  | 'waiting'
  | 'starting'
  | 'choosing_word'
  | 'drawing'
  | 'round_result'
  | 'paused'
  | 'game_result'
  | 'closed'
export type ConnectionState = 'online' | 'reconnecting' | 'left'
export type PresenceStatus = 'idle' | 'in_room' | 'playing' | 'reconnecting'
export type ToolKind = 'pen' | 'eraser' | 'fill'
export type RoomVisibility = 'public' | 'private'
export type AvatarId =
  (typeof import('../../../../config/index.ts').APP_CONFIG.player.avatarIds)[number]

export interface Profile {
  nickname: string
  avatarId: AvatarId
}
export interface PresencePreferences {
  discoverable: boolean
  acceptsInvites: boolean
}
export interface PublicPlayer {
  id: string
  nickname: string
  avatarId: AvatarId
  status: PresenceStatus
  roomId?: string
}
export interface ServerPushEnvelope<T> {
  protocolVersion: string
  data: T
}
export type Ack<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string }; requestId: string }
