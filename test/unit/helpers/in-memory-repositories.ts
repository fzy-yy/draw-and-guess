/**
 * 内存版持久化仓储（单元测试用）。
 *
 * 领域层只依赖三个仓储接口，因此用一个「内存 Map」实现即可让 GameService 在
 * 不触碰真实 SQLite（不创建 DatabaseContext、不产生临时库文件）的前提下运转。
 * 只记录本轮测试生成的记录，不做任何持久化，测试结束即随进程回收。
 * 字段值与 SQLite 实现一致（驼峰领域对象 / JSON 字符串保持原样），只用于读取与断言。
 */
import type {
  PlayerRepository,
  PlayerRecord,
} from '../../../apps/server/src/repositories/player-repository.ts'
import type {
  RoomRepository,
  RoomRecord,
  RoomMemberRecord,
} from '../../../apps/server/src/repositories/room-repository.ts'
import type {
  ArchiveRepository,
  GameArchiveRecord,
  GameResultRecord,
} from '../../../apps/server/src/repositories/archive-repository.ts'

/** 内存玩家仓储：以 id 为键；同时维护 token 索引用于 findByToken。 */
export class MemoryPlayerRepository implements PlayerRepository {
  private readonly records = new Map<string, PlayerRecord>()
  private readonly tokenIndex = new Map<string, string>()

  upsert(record: PlayerRecord): void {
    this.records.set(record.id, { ...record })
    this.tokenIndex.set(record.token, record.id)
  }

  findByToken(token: string): PlayerRecord | undefined {
    const id = this.tokenIndex.get(token)
    return id ? this.records.get(id) : undefined
  }

  setConnection(id: string, connected: boolean, disconnectedAt?: number): void {
    const record = this.records.get(id)
    if (!record) return
    record.connected = connected
    record.disconnectedAt = disconnectedAt
  }

  remove(id: string): void {
    const record = this.records.get(id)
    if (record) {
      this.tokenIndex.delete(record.token)
      this.records.delete(id)
    }
  }

  markAllDisconnected(disconnectedAt: number): void {
    for (const record of this.records.values()) {
      record.connected = false
      record.disconnectedAt = disconnectedAt
      record.roomId = undefined
    }
  }

  clearAllRoomIds(): void {
    for (const record of this.records.values()) record.roomId = undefined
  }

  deleteStaleDisconnected(_before: number): void {
    // 单测不清理过期身份，保持记录可供读取
  }
}

/** 内存房间仓储：以 id 为键；成员按房间聚合，listRooms 返回全部。 */
export class MemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, RoomRecord>()
  private readonly members = new Map<string, RoomMemberRecord[]>()

  upsertRoom(record: RoomRecord): void {
    this.rooms.set(record.id, { ...record })
  }

  listRooms(): RoomRecord[] {
    return [...this.rooms.values()].map((record) => ({ ...record }))
  }

  removeRoom(id: string): void {
    this.rooms.delete(id)
    this.members.delete(id)
  }

  replaceMembers(roomId: string, list: RoomMemberRecord[]): void {
    this.members.set(
      roomId,
      list.map((record) => ({ ...record })),
    )
  }

  saveAggregate(record: RoomRecord, list: RoomMemberRecord[]): void {
    this.rooms.set(record.id, { ...record })
    this.members.set(
      record.id,
      list.map((member) => ({ ...member })),
    )
  }
}

/** 内存战报仓储：saveGame 记录到数组，测试可断言是否落盘（单测一般不触发）。 */
export class MemoryArchiveRepository implements ArchiveRepository {
  readonly games: Array<{ archive: GameArchiveRecord; results: GameResultRecord[] }> = []

  saveGame(archive: GameArchiveRecord, results: GameResultRecord[]): void {
    this.games.push({ archive: { ...archive }, results: results.map((record) => ({ ...record })) })
  }
}

/** 便于单测一次性注入：返回内存的三个仓储实现。 */
export function createMemoryRepositories(): {
  players: MemoryPlayerRepository
  rooms: MemoryRoomRepository
  archive: MemoryArchiveRepository
} {
  return {
    players: new MemoryPlayerRepository(),
    rooms: new MemoryRoomRepository(),
    archive: new MemoryArchiveRepository(),
  }
}
