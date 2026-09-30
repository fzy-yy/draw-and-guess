/**
 * 玩家身份持久化仓储（接口 + SQLite 实现）。
 *
 * 领域层只依赖接口（见下方 PlayerRepository），便于测试时注入内存实现、生产时用 SQLite。
 * 持久化的是「跨重启可恢复」的身份关键字段（id/令牌摘要/资料/偏好/连接状态），
 * 运行时对象（socket、幂等请求缓存、限频时间窗、邀请冷却表）**不入库**——它们属于进程内瞬态，
 * 重启后由 GameService 重建（注册时重新绑定 socket、缓存清空）。
 * 接口与行类型放在本文件，SQLite 实现用 better-sqlite3 同步适配。
 */
import type { DatabaseContext } from '../db/index.ts'

/** 玩家可存档行：与 players 表字段一一对应。 */
export interface PlayerRecord {
  id: string
  tokenDigest: string
  nickname: string
  avatarId: string
  discoverable: boolean
  acceptsInvites: boolean
  connected: boolean
  joinedAt: number
  disconnectedAt?: number
}

/** 玩家身份仓储接口：领域层与存储层之间的边界。 */
export interface PlayerRepository {
  upsert(record: PlayerRecord): void
  /** 原子消费旧摘要并换成新摘要；CAS 失败表示令牌已经失效或被另一个恢复请求抢先使用。 */
  consumeRecoveryToken(
    tokenDigest: string,
    nextTokenDigest: string,
    disconnectedAfter?: number,
  ): PlayerRecord | undefined
  /** 更新连接状态与宽限时间戳（断线/上线时调用）。 */
  setConnection(id: string, connected: boolean, disconnectedAt?: number): void
  remove(id: string): void
  /**
   * 启动恢复：把全部玩家标记为断线；room_id 兼容列仅在此写一次 NULL，此后不读该列。
   * 身份保留供宽限恢复。
   */
  markAllDisconnected(disconnectedAt: number): void
  /** 删除「断线时间早于 before」的过期身份记录（启动恢复时清理历史残留，防止表无限增长）。 */
  deleteStaleDisconnected(before: number): void
}

/** better-sqlite3 实现。行对象命名遵循表列（蛇形），接口层再转驼峰。 */
export class SqlitePlayerRepository implements PlayerRepository {
  constructor(private readonly database: DatabaseContext) {}

  upsert(record: PlayerRecord): void {
    this.database.connection
      .prepare(
        `INSERT INTO players(id, token_digest, nickname, avatar_id, discoverable, accepts_invites, connected, joined_at, disconnected_at)
         VALUES (@id, @token_digest, @nickname, @avatar_id, @discoverable, @accepts_invites, @connected, @joined_at, @disconnected_at)
         ON CONFLICT(id) DO UPDATE SET
           token_digest = excluded.token_digest,
           nickname = excluded.nickname,
           avatar_id = excluded.avatar_id,
           discoverable = excluded.discoverable,
           accepts_invites = excluded.accepts_invites,
           connected = excluded.connected,
           joined_at = excluded.joined_at,
           disconnected_at = excluded.disconnected_at`,
      )
      .run(this.toRow(record))
  }

  consumeRecoveryToken(
    tokenDigest: string,
    nextTokenDigest: string,
    disconnectedAfter?: number,
  ): PlayerRecord | undefined {
    // 令牌消费是「比较并交换」：只有摘要仍等于旧值的请求才能换成新摘要，并发恢复请求会因 changes !== 1 失败；
    // 更新与回读必须在同一事务内，避免检查与更新之间被其它写操作插入。
    return this.database.withTransaction(() => {
      const connection = this.database.connection
      // 宽限窗口：只有断线时间不早于 disconnectedAfter 的记录才允许消费恢复令牌，
      // 即令牌必须在断线宽限期内使用，超期旧令牌无法再接管身份。
      const result =
        disconnectedAfter === undefined
          ? connection
              .prepare('UPDATE players SET token_digest = ? WHERE token_digest = ?')
              .run(nextTokenDigest, tokenDigest)
          : connection
              .prepare(
                `UPDATE players SET token_digest = ?
                 WHERE token_digest = ? AND disconnected_at IS NOT NULL AND disconnected_at >= ?`,
              )
              .run(nextTokenDigest, tokenDigest, disconnectedAfter)
      if (result.changes !== 1) return undefined
      const row = connection
        .prepare('SELECT * FROM players WHERE token_digest = ?')
        .get(nextTokenDigest) as PlayerRow | undefined
      return row ? this.fromRow(row) : undefined
    })
  }

  setConnection(id: string, connected: boolean, disconnectedAt?: number): void {
    this.database.connection
      .prepare('UPDATE players SET connected = ?, disconnected_at = ? WHERE id = ?')
      .run(connected ? 1 : 0, disconnectedAt ?? null, id)
  }

  remove(id: string): void {
    this.database.connection.prepare('DELETE FROM players WHERE id = ?').run(id)
  }

  markAllDisconnected(disconnectedAt: number): void {
    // room_id 为历史兼容列：仅启动恢复写一次 NULL，此后不读该列（房间不再写穿数据库）。
    this.database.connection
      .prepare('UPDATE players SET connected = 0, disconnected_at = ?, room_id = NULL')
      .run(disconnectedAt)
  }

  deleteStaleDisconnected(before: number): void {
    this.database.connection
      .prepare('DELETE FROM players WHERE disconnected_at IS NOT NULL AND disconnected_at < ?')
      .run(before)
  }

  /** 内存记录（驼峰）→ 表行（蛇形），供 SQL 命名参数使用。 */
  private toRow(record: PlayerRecord): PlayerRow {
    return {
      id: record.id,
      token_digest: record.tokenDigest,
      nickname: record.nickname,
      avatar_id: record.avatarId,
      discoverable: record.discoverable ? 1 : 0,
      accepts_invites: record.acceptsInvites ? 1 : 0,
      connected: record.connected ? 1 : 0,
      joined_at: record.joinedAt,
      disconnected_at: record.disconnectedAt ?? null,
    }
  }

  private fromRow(row: PlayerRow): PlayerRecord {
    return {
      id: row.id,
      tokenDigest: row.token_digest,
      nickname: row.nickname,
      avatarId: row.avatar_id,
      discoverable: row.discoverable === 1,
      acceptsInvites: row.accepts_invites === 1,
      connected: row.connected === 1,
      joinedAt: row.joined_at,
      disconnectedAt: row.disconnected_at ?? undefined,
    }
  }
}

/** players 表列的蛇形行类型。 */
interface PlayerRow {
  id: string
  token_digest: string
  nickname: string
  avatar_id: string
  discoverable: number
  accepts_invites: number
  connected: number
  joined_at: number
  disconnected_at: number | null
}
