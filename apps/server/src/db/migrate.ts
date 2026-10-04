/**
 * SQLite 表结构定义（基线迁移 + 追加迁移）。
 *
 * 原则：只持久化「低频关键态」，高频瞬态（画布笔画、聊天消息、计时器）不入库。
 * 项目处于开发阶段、无已发布用户，因此表结构只保留一条**最终 schema 基线**；
 * 历史上「建旧表/旧列再删除」的兼容迁移链已压缩掉，此后的结构变更一律**追加**新迁移
 * （如 v2 的战报模式列），已应用的迁移绝不改动。
 * 启动时若检测到旧版本数据库（schema_version 记录与基线不一致），直接报错提示删除本地库，不做静默升级。
 *
 * 设计取舍：
 * - 只保留玩家身份与完成局战报；
 * - 战报中的最终排名与玩家统计用 JSON TEXT 存储，避免频繁 DDL；
 * - 时间用毫秒整数（epoch ms），与前端/内存一致。
 */
import type { Database } from 'better-sqlite3'
import type { DatabaseContext } from './index.ts'

interface Migration {
  version: number
  name: string
  up: string
}

/** 当前 schema 版本（唯一权威）：新增结构变更时追加迁移并提升此数组长度。 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'baseline-schema',
    // 最终基线：玩家身份（令牌仅存摘要）+ 完成局战报（game_archive / game_results / rounds）。
    // rounds 表为将来回合级回放预留，当前 persistGameResult 不采集回合明细。
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
    // 战报新增**模式**列（S25 / S59）：只追加一列、基线不动。
    // 历史行按产品口径默认经典（当时只有经典模式），因此用 NOT NULL DEFAULT 'classic' 补齐既有行；
    // 接龙局的战报写入 'relay'，其余口径不变——依然只存最终排名与玩家总分，链明细 / 画布 / 投票不落盘。
    up: `ALTER TABLE game_archive ADD COLUMN mode TEXT NOT NULL DEFAULT 'classic';`,
  },
]

/**
 * 执行全部未应用的迁移。
 * 用 schema_version 表记录已应用的版本号：
 * - 全新库：依次执行全部迁移；
 * - 已是最新：跳过；
 * - 检测到未知版本（旧库）**直接报错**，提示删除本地数据库后重启（开发阶段不做兼容升级）。
 *
 * 事务统一走 DatabaseContext.withTransaction（与仓储写路径共用同一 seam）。
 */
export function runMigrations(context: DatabaseContext): void {
  const database: Database = context.connection
  // 记录已应用迁移版本的表；不存在则先创建。
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version   INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)
  const appliedRows = database.prepare('SELECT version, name FROM schema_version').all() as Array<{
    version: number
    name: string
  }>
  // 版本号与名称都要与基线一致：旧版 v1 的 name 是 'create-players'，与新基线同号却不同名，
  // 只比版本号会把它误判为「已应用」而静默跳过迁移（评审发现）。
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
    // 每条迁移独立事务：失败回滚，避免半成品表结构。
    context.withTransaction(() => {
      database.exec(migration.up)
      database
        .prepare('INSERT INTO schema_version(version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, Date.now())
    })
  }
}
