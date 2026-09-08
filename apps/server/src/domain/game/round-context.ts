import type { ChatMessage, RoomPhase, VocabularyWord } from '@draw-guess/shared'
import type { RuntimeLogger } from '../../errors.ts'
import type { GameSecret, PlayerSecret, RoomSecret } from '../../models.ts'
import type { RuntimeDependencies } from '../../runtime.ts'

/** RoundMachine 允许访问的最小端口，避免反向依赖整个 GameService。 */
export interface RoundContext {
  players: Map<string, PlayerSecret>
  logger: RuntimeLogger
  clock: RuntimeDependencies['clock']
  scheduler: RuntimeDependencies['scheduler']
  random: RuntimeDependencies['random']
  requireGame(room: RoomSecret): GameSecret
  findNextDrawer(room: RoomSecret, game: GameSecret): string | undefined
  pickCandidates(room: RoomSecret, game: GameSecret): VocabularyWord[]
  transition(room: RoomSecret, next: RoomPhase): void
  addMessage(room: RoomSecret, input: Omit<ChatMessage, 'id' | 'createdAt'>): void
  addSystemNotice(room: RoomSecret, text: string): void
  clearHintTimers(game: GameSecret): void
  emitRoom(roomId: string): void
  broadcastPresence(): void
  invalidateReady(room: RoomSecret, notice: string, versionMode?: 'increment' | 'preserve'): void
  persistGameResult(room: RoomSecret, reason: string): void
  isPausable(phase: RoomPhase): boolean
  safeRun(label: string, action: () => void): void
}
