/**
 * 内存版持久化仓储（单元测试用）。
 *
 * 领域层只依赖身份与战报两个仓储接口，因此用一个「内存 Map」实现即可让 GameService 在
 * 不触碰真实 SQLite（不创建 DatabaseContext、不产生临时库文件）的前提下运转。
 * 只记录本轮测试生成的记录，不做任何持久化，测试结束即随进程回收。
 * 字段值与 SQLite 实现一致（驼峰领域对象 / JSON 字符串保持原样），只用于读取与断言。
 */
import type {
  PlayerRepository,
  PlayerRecord,
} from '../../../apps/server/src/repositories/player-repository.ts'
import type {
  ArchiveRepository,
  GameArchiveRecord,
  GameResultRecord,
} from '../../../apps/server/src/repositories/archive-repository.ts'

/** 内存玩家仓储：以 id 为键；同时维护摘要索引以模拟原子令牌消费。 */
export class MemoryPlayerRepository implements PlayerRepository {
  private readonly records = new Map<string, PlayerRecord>()
  private readonly tokenIndex = new Map<string, string>()

  upsert(record: PlayerRecord): void {
    const previous = this.records.get(record.id)
    if (previous) this.tokenIndex.delete(previous.tokenDigest)
    this.records.set(record.id, { ...record })
    this.tokenIndex.set(record.tokenDigest, record.id)
  }

  consumeRecoveryToken(
    tokenDigest: string,
    nextTokenDigest: string,
    disconnectedAfter?: number,
  ): PlayerRecord | undefined {
    const id = this.tokenIndex.get(tokenDigest)
    const record = id ? this.records.get(id) : undefined
    if (
      !record ||
      (disconnectedAfter !== undefined &&
        (record.disconnectedAt === undefined || record.disconnectedAt < disconnectedAfter))
    )
      return undefined
    this.tokenIndex.delete(tokenDigest)
    record.tokenDigest = nextTokenDigest
    this.tokenIndex.set(nextTokenDigest, record.id)
    return { ...record }
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
      this.tokenIndex.delete(record.tokenDigest)
      this.records.delete(id)
    }
  }

  /** 测试只读探针：断言记录是否仍在「库」中（接口本身不需要读操作）。 */
  has(id: string): boolean {
    return this.records.has(id)
  }

  findByTokenDigest(tokenDigest: string): PlayerRecord | undefined {
    const id = this.tokenIndex.get(tokenDigest)
    const record = id ? this.records.get(id) : undefined
    return record ? { ...record } : undefined
  }

  markAllDisconnected(disconnectedAt: number): void {
    for (const record of this.records.values()) {
      record.connected = false
      record.disconnectedAt = disconnectedAt
    }
  }

  deleteStaleDisconnected(_before: number): void {
    // 单测不清理过期身份，保持记录可供读取
  }
}

/** 内存战报仓储：saveGame 记录到数组，测试可断言是否落盘（单测一般不触发）。 */
export class MemoryArchiveRepository implements ArchiveRepository {
  readonly games: Array<{ archive: GameArchiveRecord; results: GameResultRecord[] }> = []

  saveGame(archive: GameArchiveRecord, results: GameResultRecord[]): void {
    this.games.push({ archive: { ...archive }, results: results.map((record) => ({ ...record })) })
  }
}

/** 便于单测一次性注入：返回身份与战报仓储实现。 */
export function createMemoryRepositories(): {
  players: MemoryPlayerRepository
  archive: MemoryArchiveRepository
} {
  return {
    players: new MemoryPlayerRepository(),
    archive: new MemoryArchiveRepository(),
  }
}
