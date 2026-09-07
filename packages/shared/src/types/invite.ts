import type { PublicPlayer } from './common.ts'

export interface Invite {
  id: string
  roomId: string
  roomName: string
  from: PublicPlayer
  expiresAt: number
}
