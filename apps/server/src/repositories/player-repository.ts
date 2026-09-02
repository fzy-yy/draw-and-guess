/**
 * 玩家身份持久化仓储（接口 + SQLite 实现）。
 *
 * 领域层只依赖接口（见下方 PlayerRepository），便于测试时注入内存实现、生产时用 SQLite。
 * 持久化的是「跨重启可恢复」的身份关键字段（id/token/资料/偏好/连接状态），
 * 运行时对象（socket、幂等请求缓存、限频时间窗、邀请冷却表）**不入库**——它们属于进程内瞬态，
 * 重启后由 GameService 重建（regist 时重新绑定 socket、缓存清空）。
 * 接口与行类型放在本文件，SQLite 实现用 better-sqlite3 同步适配。
 */
import type { Database } from 'better-sqlite3'
import { getDb } from '../db/index.ts'

/** 玩家可存档行：与 players 表字段一一对应。 */
export interface PlayerRecord {
  id: string
  token: string
  nickname: string
  avatarId: string
  discoverable: boolean
  acceptsInvites: boolean
  connected: boolean
  joinedAt: number
  disconnectedAt?: number
  roomId?: string
}

/** 玩家身份仓储接口：领域层与存储层之间的边界。 */
export interface PlayerRepository {
  upsert(record: PlayerRecord): void
  findById(id: string): PlayerRecord | undefined
  findByToken(token: string): PlayerRecord | undefined
  /** 更新连接状态与宽限时间戳（断线/上线时调用）。 */
  setConnection(id: string, connected: boolean, disconnectedAt?: number): void
  /** 更新玩家所在房间（入房/离房/出局）。 */
  setRoom(id: string, roomId?: string): void
  /** 更新资料与偏好（改名/换头像/切换发现/邀请设置）。 */
  setProfile(
    id: string,
    field: {
      nickname?: string
      avatarId?: string
      discoverable?: boolean
      acceptsInvites?: boolean
    },
  ): void
  remove(id: string): void
  /** 启动恢复：把全部玩家标记为断线（connected=0）并清空房间归属，身份保留供宽限恢复。 */
  markAllDisconnected(disconnectedAt: number): void
  /** 清空全部玩家的房间归属（作废进行中局时用）。 */
  clearAllRoomIds(): void
  /** 删除「断线时间早于 before」的过期身份记录（启动恢复时清理历史残留，防止表无限增长）。 */
  deleteStaleDisconnected(before: number): void
}

/** better-sqlite3 实现。行对象命名遵循表列（蛇形），接口层再转驼峰。 */
export class SqlitePlayerRepository implements PlayerRepository {
  private readonly db: Database = getDb()

  upsert(record: PlayerRecord): void {
    this.db
      .prepare(
        `INSERT INTO players(id, token, nickname, avatar_id, discoverable, accepts_invites, connected, joined_at, disconnected_at, room_id)
         VALUES (@id, @token, @nickname, @avatar_id, @discoverable, @accepts_invites, @connected, @joined_at, @disconnected_at, @room_id)
         ON CONFLICT(id) DO UPDATE SET
           token = excluded.token,
           nickname = excluded.nickname,
           avatar_id = excluded.avatar_id,
           discoverable = excluded.discoverable,
           accepts_invites = excluded.accepts_invites,
           connected = excluded.connected,
           joined_at = excluded.joined_at,
           disconnected_at = excluded.disconnected_at,
           room_id = excluded.room_id`,
      )
      .run(this.toRow(record))
  }

  findById(id: string): PlayerRecord | undefined {
    const row = this.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as
      PlayerRow | undefined
    return row ? this.fromRow(row) : undefined
  }

  findByToken(token: string): PlayerRecord | undefined {
    const row = this.db.prepare('SELECT * FROM players WHERE token = ?').get(token) as
      PlayerRow | undefined
    return row ? this.fromRow(row) : undefined
  }

  setConnection(id: string, connected: boolean, disconnectedAt?: number): void {
    this.db
      .prepare('UPDATE players SET connected = ?, disconnected_at = ? WHERE id = ?')
      .run(connected ? 1 : 0, disconnectedAt ?? null, id)
  }

  setRoom(id: string, roomId?: string): void {
    this.db.prepare('UPDATE players SET room_id = ? WHERE id = ?').run(roomId ?? null, id)
  }

  setProfile(
    id: string,
    field: {
      nickname?: string
      avatarId?: string
      discoverable?: boolean
      acceptsInvites?: boolean
    },
  ): void {
    // 动态拼接仅在字段存在时更新对应列，避免把未变更字段覆盖为 undefined。
    const sets: string[] = []
    const values: unknown[] = []
    if (field.nickname !== undefined) {
      sets.push('nickname = ?')
      values.push(field.nickname)
    }
    if (field.avatarId !== undefined) {
      sets.push('avatar_id = ?')
      values.push(field.avatarId)
    }
    if (field.discoverable !== undefined) {
      sets.push('discoverable = ?')
      values.push(field.discoverable ? 1 : 0)
    }
    if (field.acceptsInvites !== undefined) {
      sets.push('accepts_invites = ?')
      values.push(field.acceptsInvites ? 1 : 0)
    }
    if (!sets.length) return
    values.push(id)
    this.db.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM players WHERE id = ?').run(id)
  }

  markAllDisconnected(disconnectedAt: number): void {
    this.db
      .prepare('UPDATE players SET connected = 0, disconnected_at = ?, room_id = NULL')
      .run(disconnectedAt)
  }

  clearAllRoomIds(): void {
    this.db.prepare('UPDATE players SET room_id = NULL').run()
  }

  deleteStaleDisconnected(before: number): void {
    this.db
      .prepare('DELETE FROM players WHERE disconnected_at IS NOT NULL AND disconnected_at < ?')
      .run(before)
  }

  /** 内存记录（驼峰）→ 表行（蛇形），供 SQL 命名参数使用。 */
  private toRow(record: PlayerRecord): PlayerRow {
    return {
      id: record.id,
      token: record.token,
      nickname: record.nickname,
      avatar_id: record.avatarId,
      discoverable: record.discoverable ? 1 : 0,
      accepts_invites: record.acceptsInvites ? 1 : 0,
      connected: record.connected ? 1 : 0,
      joined_at: record.joinedAt,
      disconnected_at: record.disconnectedAt ?? null,
      room_id: record.roomId ?? null,
    }
  }

  private fromRow(row: PlayerRow): PlayerRecord {
    return {
      id: row.id,
      token: row.token,
      nickname: row.nickname,
      avatarId: row.avatar_id,
      discoverable: row.discoverable === 1,
      acceptsInvites: row.accepts_invites === 1,
      connected: row.connected === 1,
      joinedAt: row.joined_at,
      disconnectedAt: row.disconnected_at ?? undefined,
      roomId: row.room_id ?? undefined,
    }
  }
}

/** players 表列的蛇形行类型。 */
interface PlayerRow {
  id: string
  token: string
  nickname: string
  avatar_id: string
  discoverable: number
  accepts_invites: number
  connected: number
  joined_at: number
  disconnected_at: number | null
  room_id: string | null
}
