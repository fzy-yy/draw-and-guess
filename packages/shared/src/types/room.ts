import type { ConnectionState, PublicPlayer, RoomPhase, RoomVisibility } from './common.ts'
import type { GameView } from './gameplay.ts'

export interface RoomMember extends PublicPlayer {
  seatIndex: number
  seatColor: string
  ready: boolean
  score: number
  isHost: boolean
  isDrawer: boolean
  guessed: boolean
  spectating: boolean
  leftGame: boolean
  connection: ConnectionState
  stats: { correctCount: number; totalGuessMs: number; drawingCorrectCount: number }
}
export interface RoomSettings {
  maxPlayers: number
  roundsPerPlayer: number
  drawSeconds: number
  chooseSeconds: number
  optionCount: number
  showWordLength: boolean
  progressiveHints: boolean
  structuredHintsEnabled: boolean
  hintStartRatio: number
  guessBaseScore: number
  scoreMode: 'standard' | 'flat'
  allowPlayerInvite: boolean
  allowPause: boolean
  allowWordReroll: boolean
  joinPolicy: 'forbid' | 'spectate' | 'next_game'
}
export interface PublicRoom {
  visibility: 'public'
  id: string
  name: string
  hostName: string
  playerCount: number
  maxPlayers: number
  phase: RoomPhase
  roundsPerPlayer: number
  drawSeconds: number
  joinPolicy: RoomSettings['joinPolicy']
}
export interface RoomSnapshot {
  id: string
  name: string
  hostId: string
  visibility: RoomVisibility
  privateJoinCode?: string
  phase: RoomPhase
  stateVersion: number
  settings: RoomSettings
  members: RoomMember[]
  selectedWordCount: number
  totalWordCount: number
  vocabularyPackageId?: string
  vocabularyPackageName?: string
  game?: GameView
}
export interface MemberConnectionChange {
  playerId: string
  nickname: string
  connection: ConnectionState
}
export interface PresenceSnapshot {
  players: PublicPlayer[]
  rooms: PublicRoom[]
}
