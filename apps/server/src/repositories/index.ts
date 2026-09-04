/**
 * 持久化仓储聚合出口。
 * 上层（GameService / 启动器）从这里按接口导入，便于测试时替换为内存实现。
 */
export type { PlayerRepository, PlayerRecord } from './player-repository.ts'
export { SqlitePlayerRepository } from './player-repository.ts'
export type { RoomRepository, RoomRecord, RoomMemberRecord } from './room-repository.ts'
export { SqliteRoomRepository } from './room-repository.ts'
export type {
  ArchiveRepository,
  GameArchiveRecord,
  GameResultRecord,
} from './archive-repository.ts'
export { SqliteArchiveRepository } from './archive-repository.ts'
