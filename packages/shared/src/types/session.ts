import type { PublicPlayer } from './common.ts'
import type { RoomSnapshot } from './room.ts'

export interface SessionRegistration {
  player: PublicPlayer
  recoveryToken: string
  restored: boolean
  room: RoomSnapshot | null
}
