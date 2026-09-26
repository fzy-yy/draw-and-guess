import type { RuntimeLogger } from '../../errors.ts'
import type { GameSecret, PlayerSecret, RoomSecret } from '../../models.ts'
import type { RuntimeDependencies } from '../../runtime.ts'
import type { VocabularyStore } from '../../vocabulary/index.ts'

/**
 * RoundMachine 允许访问的最小端口，避免反向依赖整个 GameService。
 *
 * 阶段写入、准备失效、对局消息与系统通知已归 RoundMachine 自身所有；
 * 这里只保留运行时、地图读取与跨模块副作用出口（传输 / 持久化 / 安全执行）。
 */
export interface RoundContext {
  players: Map<string, PlayerSecret>
  logger: RuntimeLogger
  clock: RuntimeDependencies['clock']
  scheduler: RuntimeDependencies['scheduler']
  random: RuntimeDependencies['random']
  /** 本局词库 Store（候选抽取用）；未绑定或缺省时由实现回退默认词库。 */
  getRoomVocabularyStore(room?: RoomSecret): VocabularyStore
  requireGame(room: RoomSecret): GameSecret
  /** 推送 systemNotice 事件（系统通知的唯一传输出口）。 */
  emitSystemNotice(roomId: string, text: string): void
  emitRoom(roomId: string): void
  broadcastPresence(): void
  persistGameResult(room: RoomSecret, reason: string): void
  safeRun(label: string, action: () => void): void
}