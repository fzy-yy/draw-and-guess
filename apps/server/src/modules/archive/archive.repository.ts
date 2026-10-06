/**
 * 对局战报持久化仓储（接口定义 + 基于 StatementCache 的 SQLite 实现）。
 *
 * 遵循《后端架构规范》R4.5a 与 R4.5c：
 * 1. SQL 语句严格封装在 Repository 内部；
 * 2. 预编译语句通过 StatementCache 缓存复用，避免每次执行重复编译 SQL；
 * 3. 对局档案与成员结果通过 DatabaseContext.withTransaction() 在 BEGIN IMMEDIATE 事务内原子写入。
 */
import type { DatabaseContext } from '../../infra/sqlite/connection.ts'
import type { GameArchiveRecord, GameResultRecord } from './archive.model.ts'

/**
 * 战报持久化仓储接口契约。
 */
export interface ArchiveRepository {
  /**
   * 在单一原子事务内保存完整战报：档案基本信息 + 成员成绩列表。
   */
  saveGame(archive: GameArchiveRecord, results: GameResultRecord[]): void
}

/**
 * 基于 SQLite 与 StatementCache 的战报仓储实现。
 */
export class SqliteArchiveRepository implements ArchiveRepository {
  constructor(private readonly database: DatabaseContext) {}

  saveGame(archive: GameArchiveRecord, results: GameResultRecord[]): void {
    this.database.withTransaction(() => {
      // 1. 写入或更新 game_archive 主表（经预编译缓存）
      const upsertArchiveStmt = this.database.statements.get(
        `INSERT INTO game_archive(id, room_id, started_at, finished_at, total_rounds, final_ranking, reason, mode)
         VALUES (@id, @roomId, @startedAt, @finishedAt, @totalRounds, @finalRanking, @reason, @mode)
         ON CONFLICT(id) DO UPDATE SET
           room_id = excluded.room_id,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           total_rounds = excluded.total_rounds,
           final_ranking = excluded.final_ranking,
           reason = excluded.reason,
           mode = excluded.mode`,
      )

      upsertArchiveStmt.run({
        id: archive.id,
        roomId: archive.roomId,
        startedAt: archive.startedAt,
        finishedAt: archive.finishedAt,
        totalRounds: archive.totalRounds,
        finalRanking: archive.finalRanking,
        reason: archive.reason ?? null,
        mode: archive.mode,
      })

      // 2. 批量写入成员成绩子表（循环复用缓存语句）
      const upsertResultStmt = this.database.statements.get(
        `INSERT INTO game_results(game_id, player_id, nickname, avatar_id, rank, score, stats)
         VALUES (@gameId, @playerId, @nickname, @avatarId, @rank, @score, @stats)
         ON CONFLICT(game_id, player_id) DO UPDATE SET
           nickname = excluded.nickname,
           avatar_id = excluded.avatar_id,
           rank = excluded.rank,
           score = excluded.score,
           stats = excluded.stats`,
      )

      for (const result of results) {
        upsertResultStmt.run({
          gameId: result.gameId,
          playerId: result.playerId,
          nickname: result.nickname,
          avatarId: result.avatarId,
          rank: result.rank,
          score: result.score,
          stats: result.stats,
        })
      }
    })
  }
}
