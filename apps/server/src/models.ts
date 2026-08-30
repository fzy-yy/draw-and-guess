/**
 * 服务端内存领域模型。
 * 带 Secret 后缀的数据绝不原样发送给客户端；公开快照必须通过 GameService 的裁剪函数生成。
 */
import type { Socket } from 'socket.io'
import type {
  ChatMessage,
  PresencePreferences,
  Profile,
  RoomPhase,
  RoomSettings,
  DrawingCommand,
  RoundResult,
  VocabularyItem,
} from '@draw-guess/shared'

export interface PlayerSecret {
  id: string
  token: string
  profile: Profile
  preferences: PresencePreferences
  socket?: Socket
  socketId?: string
  roomId?: string
  connected: boolean
  joinedAt: number
  disconnectedAt?: number
  disconnectTimer?: NodeJS.Timeout
  requestCache: Map<string, unknown>
  lastInviteAt: Map<string, number>
  /** 一秒滑动窗口内的猜词与绘图事件时间，用于局域网刷包保护。 */
  guessEventTimes: number[]
  drawEventTimes: number[]
}

export interface MemberState {
  playerId: string
  ready: boolean
  score: number
  joinedAt: number
  guessedAt?: number
  stats: {
    correctCount: number
    totalGuessMs: number
    drawingCorrectCount: number
  }
}

export interface GameSecret {
  id: string
  roundId: string
  phaseStartedAt: number
  phaseEndsAt: number
  phaseBeforePause?: RoomPhase
  pausedRemainingMs?: number
  currentRound: number
  totalRounds: number
  drawerOrder: string[]
  drawerId: string
  candidates: VocabularyItem[]
  answer?: VocabularyItem
  usedWordIds: Set<string>
  /** 自由笔画与区域填充共用一条内存历史，支持统一撤销、重做与重连恢复。 */
  strokes: DrawingCommand[]
  undoneStrokeIds: string[]
  lastSequence: number
  messages: ChatMessage[]
  correctOrder: string[]
  revealedIndices: Set<number>
  roundResult?: RoundResult
  timer?: NodeJS.Timeout
  /** 绘图阶段的逐步提示计时器，与主阶段计时器一起在暂停/切换时清理。 */
  hintTimers?: NodeJS.Timeout[]
}

export interface RoomSecret {
  id: string
  name: string
  hostId: string
  phase: RoomPhase
  stateVersion: number
  settings: RoomSettings
  members: MemberState[]
  selectedWordIds: Set<string>
  game?: GameSecret
  createdAt: number
}

export interface InviteSecret {
  id: string
  fromPlayerId: string
  toPlayerId: string
  roomId: string
  expiresAt: number
  timer: NodeJS.Timeout
}
