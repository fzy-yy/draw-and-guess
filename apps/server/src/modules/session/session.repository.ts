/**
 * 玩家身份持久化仓储（接口定义 + 基于 StatementCache 的 SQLite 实现）。
 *
 * 遵循《后端架构规范》R4.5a、R4.5c 与 R4.5h：
 * 1. SQL 语句收敛在仓储内，使用显式列清单，杜绝 SELECT *；
 * 2. 预编译语句经 StatementCache 缓存复用；
 * 3. 消费恢复令牌采用 CAS 原子比对并换取新摘要，处于单一事务保护下。
 */
import type { DatabaseContext } from '../../infra/sqlite/connection.ts'
import type { PlayerRecord } from './session.model.ts'

/** 显式查询列清单，避免 SELECT * 导致隐式重名丢列或列顺序漂移 */
const PLAYER_COLUMNS =
  'id, token_digest, nickname, avatar_id, discoverable, accepts_invites, connected, joined_at, disconnected_at'

/**
 * 玩家身份仓储接口契约。
 */
export interface PlayerRepository {
  /** 写入或全量更新玩家身份记录 */
  upsert(record: PlayerRecord): void
  /**
   * 原子消费恢复令牌（CAS 操作）：
   * 仅当当前库中 token_digest == tokenDigest（且在宽限窗口内）时，将其更新为 nextTokenDigest 并返回更新后的记录。
   */
  consumeRecoveryToken(
    tokenDigest: string,
    nextTokenDigest: string,
    disconnectedAfter?: number,
  ): PlayerRecord | undefined
  /** 更新指定玩家的在线状态及断线时间戳 */
  setConnection(id: string, connected: boolean, disconnectedAt?: number): void
  /** 物理删除玩家记录 */
  remove(id: string): void
  /** 服务启动恢复：全员标记为断线，保留身份等待宽限期恢复 */
  markAllDisconnected(disconnectedAt: number): void
  /** 清理断线时间早于 before 的历史过期僵尸记录 */
  deleteStaleDisconnected(before: number): void
}

/** 对应 SQLite 表的底层蛇形字段行结构 */
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

/**
 * 基于 SQLite 与 StatementCache 的玩家仓储实现。
 */
export class SqlitePlayerRepository implements PlayerRepository {
  constructor(private readonly database: DatabaseContext) {}

  upsert(record: PlayerRecord): void {
    const stmt = this.database.statements.get(
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
    stmt.run(this.toRow(record))
  }

  consumeRecoveryToken(
    tokenDigest: string,
    nextTokenDigest: string,
    disconnectedAfter?: number,
  ): PlayerRecord | undefined {
    return this.database.withTransaction(() => {
      const result =
        disconnectedAfter === undefined
          ? this.database.statements
              .get('UPDATE players SET token_digest = ? WHERE token_digest = ?')
              .run(nextTokenDigest, tokenDigest)
          : this.database.statements
              .get(
                `UPDATE players SET token_digest = ?
                 WHERE token_digest = ? AND disconnected_at IS NOT NULL AND disconnected_at >= ?`,
              )
              .run(nextTokenDigest, tokenDigest, disconnectedAfter)

      if (result.changes !== 1) {
        return undefined
      }

      const selectStmt = this.database.statements.get(
        `SELECT ${PLAYER_COLUMNS} FROM players WHERE token_digest = ?`,
      )
      const row = selectStmt.get(nextTokenDigest) as PlayerRow | undefined
      return row ? this.fromRow(row) : undefined
    })
  }

  setConnection(id: string, connected: boolean, disconnectedAt?: number): void {
    const stmt = this.database.statements.get(
      'UPDATE players SET connected = ?, disconnected_at = ? WHERE id = ?',
    )
    stmt.run(connected ? 1 : 0, disconnectedAt ?? null, id)
  }

  remove(id: string): void {
    const stmt = this.database.statements.get('DELETE FROM players WHERE id = ?')
    stmt.run(id)
  }

  markAllDisconnected(disconnectedAt: number): void {
    const stmt = this.database.statements.get(
      'UPDATE players SET connected = 0, disconnected_at = ?',
    )
    stmt.run(disconnectedAt)
  }

  deleteStaleDisconnected(before: number): void {
    const stmt = this.database.statements.get(
      'DELETE FROM players WHERE disconnected_at IS NOT NULL AND disconnected_at < ?',
    )
    stmt.run(before)
  }

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
