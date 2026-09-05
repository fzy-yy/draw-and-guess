/**
 * SQLite 表结构迁移定义。
 *
 * 原则：只持久化「低频关键态」，高频瞬态（画布笔画、聊天消息、计时器）不入库。
 * 采用最简的版本化迁移：migrations 数组按序执行，已应用的记录在 schema_version 表中，
 * 保证升级可重复、可回滚思路清晰。新增字段一律走「追加迁移」，不直接改已建表。
 *
 * 设计取舍：
 * - 聚合根（Player / Room）与其从表（成员、战绩）分开，保留外键便于级联与查询；
 * - 可扩展字段（房间规则、成员统计、得分明细、词库选择）用 JSON TEXT 存储，
 *   避免频繁 DDL；这些字段服务端权威快照本来就会重新裁剪，落盘仅是存档用途；
 * - 时间用毫秒整数（epoch ms），与前端/内存一致。
 */
import type { Database } from 'better-sqlite3'
import { getDb } from './index.ts'

export interface Migration {
  version: number
  name: string
  up: string // 建表/变更 SQL
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'create-players',
    // 玩家身份：跨重启的宽限恢复依赖它。token 唯一用于令牌接管，昵称/头像/偏好公开。
    up: `
      CREATE TABLE IF NOT EXISTS players (
        id              TEXT PRIMARY KEY,                -- 玩家 UUID（服务端签发）
        token           TEXT NOT NULL UNIQUE,            -- 恢复令牌（仅进程内使用，仍持久化以便跨重启）
        nickname        TEXT NOT NULL,                   -- 昵称（已做唯一化处理）
        avatar_id       TEXT NOT NULL,                   -- 内置 SVG 头像编号
        discoverable    INTEGER NOT NULL DEFAULT 1,      -- 是否允许被大厅发现
        accepts_invites INTEGER NOT NULL DEFAULT 1,      -- 是否接受邀请
        connected       INTEGER NOT NULL DEFAULT 0,      -- 是否在线（宽限期内为 0）
        joined_at       INTEGER NOT NULL,                -- 注册时间（epoch ms）
        disconnected_at INTEGER,                         -- 最近断线时间（用于宽限判断）
        room_id         TEXT                             -- 所在房间（内存态为准，这里仅用于恢复）
      );
      CREATE INDEX IF NOT EXISTS idx_players_token ON players(token);
      CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
    `,
  },
  {
    version: 2,
    name: 'create-rooms-and-members',
    // 房间与成员：进行中局「作废/恢复」依赖它。settings/selected_words 用 JSON 存，便于扩展。
    up: `
      CREATE TABLE IF NOT EXISTS rooms (
        id              TEXT PRIMARY KEY,                -- 房间 UUID
        name            TEXT NOT NULL,                   -- 房间名
        host_id         TEXT NOT NULL,                   -- 房主玩家 id
        visibility      TEXT NOT NULL,                   -- public | private
        private_code    TEXT,                            -- 私密房码（仅服务端生成）
        phase           TEXT NOT NULL DEFAULT 'waiting', -- 房间阶段（内存态权威，落盘仅供恢复/审计）
        state_version   INTEGER NOT NULL DEFAULT 1,      -- 乐观并发版本号
        settings        TEXT NOT NULL,                   -- JSON：房间规则（RoomSettings）
        selected_words  TEXT NOT NULL,                   -- JSON：本局启用词条 id 数组
        created_at      INTEGER NOT NULL,                -- 建房时间
        updated_at      INTEGER NOT NULL                 -- 最近一次状态变更时间
      );
      CREATE INDEX IF NOT EXISTS idx_rooms_phase ON rooms(phase);

      CREATE TABLE IF NOT EXISTS room_members (
        room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        seat_index  INTEGER NOT NULL,                    -- 席位号（0~5，整局稳定）
        spectating  INTEGER NOT NULL DEFAULT 0,          -- 是否观战（游戏中加入）
        left_game   INTEGER NOT NULL DEFAULT 0,          -- 是否已退出本局（保留成绩卡）
        ready       INTEGER NOT NULL DEFAULT 0,          -- 是否已准备
        score       INTEGER NOT NULL DEFAULT 0,          -- 本局累计得分
        joined_at   INTEGER NOT NULL,                    -- 加入房间时间
        stats       TEXT NOT NULL DEFAULT '{}',          -- JSON：公开统计（correctCount 等）
        PRIMARY KEY (room_id, player_id)
      );
      CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id);
    `,
  },
  {
    version: 3,
    name: 'create-game-archive',
    // 对局战绩档：一局一行，冻结最终排名。供赛后回看/统计。
    up: `
      CREATE TABLE IF NOT EXISTS game_archive (
        id              TEXT PRIMARY KEY,                -- 对局 UUID
        room_id         TEXT NOT NULL,                   -- 来源房间
        started_at      INTEGER NOT NULL,                -- 开局时间
        finished_at     INTEGER NOT NULL,                -- 结束时间
        total_rounds    INTEGER NOT NULL,                -- 总回合数
        final_ranking   TEXT NOT NULL,                   -- JSON：FinalRankingEntry[]
        reason          TEXT                             -- 结束原因（全部完成/房主提前/人数不足等）
      );
      CREATE INDEX IF NOT EXISTS idx_game_archive_room ON game_archive(room_id);
    `,
  },
  {
    version: 4,
    name: 'create-rounds-and-results',
    // 逐局玩家结果（game_results）已接入；rounds 表为将来回合级回放预留，
    // 当前 persistGameResult 不采集回合明细（详见 repositories/archive-repository.ts 与 game-service）。
    up: `
      CREATE TABLE IF NOT EXISTS game_results (
        game_id     TEXT NOT NULL REFERENCES game_archive(id) ON DELETE CASCADE,
        player_id   TEXT NOT NULL,
        nickname    TEXT NOT NULL,                       -- 结算时冻结的昵称
        avatar_id   TEXT NOT NULL,                       -- 结算时冻结的头像
        rank        INTEGER NOT NULL,                    -- 名次（同分并列）
        score       INTEGER NOT NULL,                    -- 总得分
        stats       TEXT NOT NULL DEFAULT '{}',          -- JSON：最终统计（correctCount 等）
        PRIMARY KEY (game_id, player_id)
      );

      CREATE TABLE IF NOT EXISTS rounds (
        id              TEXT PRIMARY KEY,                -- 回合 UUID（roundId）
        game_id         TEXT NOT NULL REFERENCES game_archive(id) ON DELETE CASCADE,
        round_no        INTEGER NOT NULL,                -- 回合序号（1 起）
        drawer_id       TEXT,                            -- 画家
        answer          TEXT NOT NULL,                   -- 答案词面（结算阶段才落盘）
        drawer_score    INTEGER NOT NULL DEFAULT 0,      -- 画家本回合作画得分
        correct_details TEXT NOT NULL DEFAULT '[]',      -- JSON：ScoreDetail[]（猜中者明细）
        started_at      INTEGER NOT NULL,
        ended_at        INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rounds_game ON rounds(game_id);
    `,
  },
]

/**
 * 执行全部未应用的迁移。
 * 用 schema_version 表记录已应用的版本号：
 * - 幂等：已应用的版本跳过，未应用的按 version 升序依次执行；
 * - 每个迁移在独立事务内执行，失败即回滚该条，不污染既有数据。
 * 首次启动会创建 schema_version 并跑完全部迁移；升级时新增迁移会被自动应用。
 */
export function runMigrations(): void {
  const database: Database = getDb()
  // 记录已应用迁移版本的表；不存在则先创建。
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version   INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)
  const applied = new Set<number>(
    (
      database.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>
    ).map((row) => row.version),
  )
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    // 每条迁移独立事务：失败回滚，避免半成品表结构。
    const apply = database.transaction(() => {
      database.exec(migration.up)
      database
        .prepare('INSERT INTO schema_version(version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, Date.now())
    })
    apply()
  }
}
