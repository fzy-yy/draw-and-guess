/**
 * 房间与成员持久化仓储（接口 + SQLite 实现）。
 *
 * 房间/对局本质是内存态（画布、消息、计时器不入库），这里只持久化「作废/恢复」所需的关键字段：
 * 房间配置、词库选择、成员席位。服务重启时 recoverOnStartup 会**无条件删除全部房间记录**
 * （对局全在内存，重启即丢失，作废关闭是务实策略），落盘的唯一价值是清理时不留幽灵数据。
 * 高频瞬态（笔画、消息、得分明细的实时部分）一律不入库。
 *
 * 映射约定：数据库行键 = 表列名（蛇形），对外领域对象（RoomRecord）用驼峰；
 * 由本文件内的 toSnake/fromSnake 私有方法负责双向转换，SQL 命名参数统一用蛇形（与列名一致）。
 */
import type { Database } from 'better-sqlite3'
import { getDb } from '../db/index.ts'

/** 房间可存档对象（驼峰，供领域层使用）。settings/selectedWords 以 JSON 字符串存储以保可扩展。 */
export interface RoomRecord {
  id: string
  name: string
  hostId: string
  visibility: string
  privateCode?: string
  phase: string
  stateVersion: number
  settings: string // JSON：RoomSettings
  selectedWords: string // JSON：词条 id 数组
  createdAt: number
  updatedAt: number
}

/** 房间成员可存档对象（驼峰）。 */
export interface RoomMemberRecord {
  roomId: string
  playerId: string
  seatIndex: number
  spectating: boolean
  leftGame: boolean
  ready: boolean
  score: number
  joinedAt: number
  stats: string // JSON：公开统计
}

export interface RoomRepository {
  /** 插入或更新房间（upsert，按 id 覆盖）。 */
  upsertRoom(record: RoomRecord): void
  /** 列出全部房间（启动作废扫描用）。 */
  listRooms(): RoomRecord[]
  removeRoom(id: string): void
  /** 替换某房间的成员集合（入房/离房/清空时调用）。 */
  replaceMembers(roomId: string, members: RoomMemberRecord[]): void
}

/** 房间表行（蛇形，对应 SELECT * 返回的列名）。 */
interface RoomRow {
  id: string
  name: string
  host_id: string
  visibility: string
  private_code: string | null
  phase: string
  state_version: number
  settings: string
  selected_words: string
  created_at: number
  updated_at: number
}

/** 房间成员表行（蛇形）。 */
interface RoomMemberRow {
  room_id: string
  player_id: string
  seat_index: number
  spectating: number
  left_game: number
  ready: number
  score: number
  joined_at: number
  stats: string
}

export class SqliteRoomRepository implements RoomRepository {
  private readonly db: Database = getDb()

  upsertRoom(record: RoomRecord): void {
    this.db
      .prepare(
        `INSERT INTO rooms(id, name, host_id, visibility, private_code, phase, state_version, settings, selected_words, created_at, updated_at)
         VALUES (@id, @name, @host_id, @visibility, @private_code, @phase, @state_version, @settings, @selected_words, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           host_id = excluded.host_id,
           visibility = excluded.visibility,
           private_code = excluded.private_code,
           phase = excluded.phase,
           state_version = excluded.state_version,
           settings = excluded.settings,
           selected_words = excluded.selected_words,
           updated_at = excluded.updated_at`,
      )
      .run(this.toRoomRow(record))
  }

  listRooms(): RoomRecord[] {
    const rows = this.db.prepare('SELECT * FROM rooms').all() as RoomRow[]
    return rows.map((row) => this.fromRoomRow(row))
  }

  removeRoom(id: string): void {
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id)
  }

  replaceMembers(roomId: string, members: RoomMemberRecord[]): void {
    // 替换成员集合放在一个事务里：先清空该房间全部成员，再逐条插入，保证不残留旧席位。
    const replace = this.db.transaction(() => {
      this.db.prepare('DELETE FROM room_members WHERE room_id = ?').run(roomId)
      const insert = this.db.prepare(
        `INSERT INTO room_members(room_id, player_id, seat_index, spectating, left_game, ready, score, joined_at, stats)
         VALUES (@room_id, @player_id, @seat_index, @spectating, @left_game, @ready, @score, @joined_at, @stats)`,
      )
      for (const member of members) insert.run(this.toMemberRow(member))
    })
    replace()
  }

  /** 领域对象（驼峰）→ 表行（蛇形），供 SQL 命名参数使用。 */
  private toRoomRow(record: RoomRecord): RoomRow {
    return {
      id: record.id,
      name: record.name,
      host_id: record.hostId,
      visibility: record.visibility,
      private_code: record.privateCode ?? null,
      phase: record.phase,
      state_version: record.stateVersion,
      settings: record.settings,
      selected_words: record.selectedWords,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    }
  }

  /** 表行（蛇形）→ 领域对象（驼峰）。 */
  private fromRoomRow(row: RoomRow): RoomRecord {
    return {
      id: row.id,
      name: row.name,
      hostId: row.host_id,
      visibility: row.visibility,
      privateCode: row.private_code ?? undefined,
      phase: row.phase,
      stateVersion: row.state_version,
      settings: row.settings,
      selectedWords: row.selected_words,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /** 领域对象（驼峰）→ 成员表行（蛇形）。 */
  private toMemberRow(record: RoomMemberRecord): RoomMemberRow {
    return {
      room_id: record.roomId,
      player_id: record.playerId,
      seat_index: record.seatIndex,
      spectating: record.spectating ? 1 : 0,
      left_game: record.leftGame ? 1 : 0,
      ready: record.ready ? 1 : 0,
      score: record.score,
      joined_at: record.joinedAt,
      stats: record.stats,
    }
  }

  /** 成员表行（蛇形）→ 领域对象（驼峰）。 */
  private fromMemberRow(row: RoomMemberRow): RoomMemberRecord {
    return {
      roomId: row.room_id,
      playerId: row.player_id,
      seatIndex: row.seat_index,
      spectating: row.spectating === 1,
      leftGame: row.left_game === 1,
      ready: row.ready === 1,
      score: row.score,
      joinedAt: row.joined_at,
      stats: row.stats,
    }
  }
}
