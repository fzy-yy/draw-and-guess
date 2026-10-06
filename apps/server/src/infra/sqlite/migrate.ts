/**
 * SQLite 表结构版本化迁移。
 *
 * 遵循《后端架构规范》R4.5g：
 * 1. 迁移历史保持只追加、不修改原则；
 * 2. 幂等执行：每次启动时检测当前 schema_version，仅执行未应用的新增迁移；
 * 3. 事务保护：所有迁移在 DatabaseContext 事务内统一推进。
 */
import type { Database } from 'better-sqlite3'
import type { DatabaseContext } from './connection.ts'

/** 单次迁移定义契约 */
export interface Migration {
  /** 递增版本号（从 1 开始） */
  version: number
  /** 稳定迁移名称 */
  name: string
  /** 升级 DDL 脚本 */
  up: string
}

/**
 * 当前 schema 迁移链（唯一权威）：新增结构变更时在此追加。
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'baseline-schema',
    // 最终基线：玩家身份（令牌仅存摘要）+ 完成局战报（game_archive / game_results / rounds）。
    up: `
      CREATE TABLE IF NOT EXISTS players (
        id              TEXT PRIMARY KEY,                -- 玩家 UUID（服务端签发）
        token_digest    TEXT NOT NULL UNIQUE,            -- 恢复令牌的 SHA-256 摘要（明文不落盘）
        nickname        TEXT NOT NULL,                   -- 昵称（已做唯一化处理）
        avatar_id       TEXT NOT NULL,                   -- 内置 SVG 头像编号
        discoverable    INTEGER NOT NULL DEFAULT 1,      -- 是否允许被大厅发现
        accepts_invites INTEGER NOT NULL DEFAULT 1,      -- 是否接受邀请
        connected       INTEGER NOT NULL DEFAULT 0,      -- 是否在线（宽限期内为 0）
        joined_at       INTEGER NOT NULL,                -- 注册时间（epoch ms）
        disconnected_at INTEGER                          -- 最近断线时间（用于宽限判断）
      );

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
  {
    version: 2,
    name: 'game-archive-mode',
    // 战报新增玩法模式列（接龙写 relay，经典写 classic，历史行默认 classic）。
    up: `ALTER TABLE game_archive ADD COLUMN mode TEXT NOT NULL DEFAULT 'classic';`,
  },
]

/**
 * 执行全部未应用的数据库迁移。
 *
 * @param context 数据库上下文
 */
export function runMigrations(context: DatabaseContext): void {
  const database: Database = context.connection

  // 初始化迁移记录表
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name    TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)

  const appliedRows = database.prepare('SELECT version, name FROM schema_version').all() as Array<{
    version: number
    name: string
  }>

  const known = new Map(MIGRATIONS.map((migration) => [migration.version, migration.name]))
  const legacy = appliedRows.filter((row) => known.get(row.version) !== row.name)
  if (legacy.length > 0) {
    throw new Error(
      `检测到旧版本数据库（schema 版本 ${legacy.map((row) => row.version).join('、')}）。本项目尚在开发阶段、已重置表结构，` +
        `请删除本地数据库文件（源码运行：apps/server/data/game.db；分发产物：data/game.db）后重启服务。`,
    )
  }
  const appliedSet = new Set(appliedRows.map((row) => row.version))
  for (const migration of MIGRATIONS) {
    if (appliedSet.has(migration.version)) continue
    context.withTransaction(() => {
      database.exec(migration.up)
      database
        .prepare('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, Date.now())
    })
  }
}
