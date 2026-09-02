/**
 * 对局战报持久化仓储（接口 + SQLite 实现）。
 *
 * 负责每局结束（finishGame）与每回合结算（finishRound）的落盘：
 * - game_archive：一局一行，冻结最终排名（FinalRankingEntry[]）；
 * - game_results：逐玩家本局结果（名次、总得分、统计）；
 * - rounds：逐回合明细（答案、画家、画作得分、猜中明细），供比分来源回看。
 *
 * 这些数据在领域层结算瞬间已经冻结（finalRanking / roundResult），落盘只是把内存对象序列化，
 * 不改变裁决逻辑，保证「展示分 = 入账分」。战绩为低频写，无性能顾虑。
 */
import type { Database } from 'better-sqlite3'
import { getDb, withTransaction } from '../db/index.ts'

/** 一局战报（game_archive 行）。finalRanking 为 JSON 序列化的最终排行。 */
export interface GameArchiveRecord {
  id: string
  roomId: string
  startedAt: number
  finishedAt: number
  totalRounds: number
  finalRanking: string // JSON：FinalRankingEntry[]
  reason?: string
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

/** 单回合明细（rounds 行）。 */
export interface RoundRecord {
  id: string
  gameId: string
  roundNo: number
  drawerId?: string
  answer: string
  drawerScore: number
  correctDetails: string // JSON：ScoreDetail[]
  startedAt: number
  endedAt: number
}

export interface ArchiveRepository {
  /** 在一个事务内写入整局战报：档案、逐玩家结果、逐回合明细，保证原子。 */
  saveGame(archive: GameArchiveRecord, results: GameResultRecord[], rounds: RoundRecord[]): void
  /** 写入单回合明细（可在整局完成前按回合逐步落盘点）。 */
  saveRound(round: RoundRecord): void
  /** 查询某房间的历史战报（倒序）。 */
  listByRoom(roomId: string, limit: number): GameArchiveRecord[]
  /** 查询某局结果（仅供内部校验）。 */
  listResults(gameId: string): GameResultRecord[]
}

/** SQLite 实现：全部写操作在事务内执行，保证档案/结果/回合三者一致。 */
export class SqliteArchiveRepository implements ArchiveRepository {
  private readonly db: Database = getDb()

  saveGame(archive: GameArchiveRecord, results: GameResultRecord[], rounds: RoundRecord[]): void {
    withTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO game_archive(id, room_id, started_at, finished_at, total_rounds, final_ranking, reason)
           VALUES (@id, @roomId, @startedAt, @finishedAt, @totalRounds, @finalRanking, @reason)
           ON CONFLICT(id) DO UPDATE SET
             room_id = excluded.room_id,
             started_at = excluded.started_at,
             finished_at = excluded.finished_at,
             total_rounds = excluded.total_rounds,
             final_ranking = excluded.final_ranking,
             reason = excluded.reason`,
        )
        .run({
          id: archive.id,
          roomId: archive.roomId,
          startedAt: archive.startedAt,
          finishedAt: archive.finishedAt,
          totalRounds: archive.totalRounds,
          finalRanking: archive.finalRanking,
          reason: archive.reason ?? null,
        })
      for (const result of results) {
        this.db
          .prepare(
            `INSERT INTO game_results(game_id, player_id, nickname, avatar_id, rank, score, stats)
             VALUES (@gameId, @playerId, @nickname, @avatarId, @rank, @score, @stats)
             ON CONFLICT(game_id, player_id) DO UPDATE SET
               nickname = excluded.nickname,
               avatar_id = excluded.avatar_id,
               rank = excluded.rank,
               score = excluded.score,
               stats = excluded.stats`,
          )
          .run({
            gameId: result.gameId,
            playerId: result.playerId,
            nickname: result.nickname,
            avatarId: result.avatarId,
            rank: result.rank,
            score: result.score,
            stats: result.stats,
          })
      }
      for (const round of rounds) {
        this.saveRound(round)
      }
    })
  }

  saveRound(round: RoundRecord): void {
    this.db
      .prepare(
        `INSERT INTO rounds(id, game_id, round_no, drawer_id, answer, drawer_score, correct_details, started_at, ended_at)
         VALUES (@id, @gameId, @roundNo, @drawerId, @answer, @drawerScore, @correctDetails, @startedAt, @endedAt)
         ON CONFLICT(id) DO UPDATE SET
           drawer_id = excluded.drawer_id,
           answer = excluded.answer,
           drawer_score = excluded.drawer_score,
           correct_details = excluded.correct_details,
           ended_at = excluded.ended_at`,
      )
      .run({
        id: round.id,
        gameId: round.gameId,
        roundNo: round.roundNo,
        drawerId: round.drawerId ?? null,
        answer: round.answer,
        drawerScore: round.drawerScore,
        correctDetails: round.correctDetails,
        startedAt: round.startedAt,
        endedAt: round.endedAt,
      })
  }

  listByRoom(roomId: string, limit = 20): GameArchiveRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM game_archive WHERE room_id = ? ORDER BY finished_at DESC LIMIT ?')
      .all(roomId, limit) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      roomId: String(row.room_id),
      startedAt: Number(row.started_at),
      finishedAt: Number(row.finished_at),
      totalRounds: Number(row.total_rounds),
      finalRanking: String(row.final_ranking),
      reason: row.reason ? String(row.reason) : undefined,
    }))
  }

  listResults(gameId: string): GameResultRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM game_results WHERE game_id = ?')
      .all(gameId) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      gameId: String(row.game_id),
      playerId: String(row.player_id),
      nickname: String(row.nickname),
      avatarId: String(row.avatar_id),
      rank: Number(row.rank),
      score: Number(row.score),
      stats: String(row.stats),
    }))
  }
}
