/**
 * 对局战报持久化仓储（接口 + SQLite 实现）。
 *
 * 负责每局结束（finishGame）的落盘：
 * - game_archive：一局一行，冻结最终排名（FinalRankingEntry[] / RelayFinalRankingEntry[]）与玩法模式；
 * - game_results：逐玩家本局结果（名次、总得分、统计）。
 * （rounds 表为将来回合级回放预留，本期不写入，见 db/migrate.ts。）
 *
 * 这些数据在领域层结算瞬间已经冻结（finalRanking），落盘只是把内存对象序列化，
 * 不改变裁决逻辑，保证「展示分 = 入账分」。战绩为低频写，无性能顾虑。
 */
import type { GameMode } from '@draw-guess/shared'
import type { DatabaseContext } from '../db/index.ts'

/** 一局战报（game_archive 行）。finalRanking 为 JSON 序列化的最终排行。 */
export interface GameArchiveRecord {
  id: string
  roomId: string
  startedAt: number
  finishedAt: number
  totalRounds: number
  finalRanking: string // JSON：FinalRankingEntry[] | RelayFinalRankingEntry[]
  reason?: string
  /** 本局玩法模式（S25 / S59）：接龙写 `relay`，经典写 `classic`（历史行经迁移默认 classic）。 */
  mode: GameMode
}

/** 逐玩家本局结果（game_results 行）。 */
export interface GameResultRecord {
  gameId: string
  playerId: string
  nickname: string
  avatarId: string
  rank: number
  score: number
  stats: string // JSON：公开统计
}

export interface ArchiveRepository {
  /** 在一个事务内写入整局战报：档案 + 逐玩家结果，保证原子。 */
  saveGame(archive: GameArchiveRecord, results: GameResultRecord[]): void
}

/** SQLite 实现：全部写操作经 DatabaseContext 的事务 seam 执行，保证档案与结果一致。 */
export class SqliteArchiveRepository implements ArchiveRepository {
  constructor(private readonly database: DatabaseContext) {}

  saveGame(archive: GameArchiveRecord, results: GameResultRecord[]): void {
    this.database.withTransaction(() => {
      const connection = this.database.connection
      connection
        .prepare(
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
        .run({
          id: archive.id,
          roomId: archive.roomId,
          startedAt: archive.startedAt,
          finishedAt: archive.finishedAt,
          totalRounds: archive.totalRounds,
          finalRanking: archive.finalRanking,
          reason: archive.reason ?? null,
          mode: archive.mode,
        })
      // 逐玩家结果的行结构相同：prepare 一次在循环内复用，避免为每条结果重复解析 SQL。
      const upsertResult = connection.prepare(
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
        upsertResult.run({
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
