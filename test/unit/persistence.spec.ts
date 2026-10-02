import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDatabase, type DatabaseContext } from '../../apps/server/src/db/index.ts'
import { MIGRATIONS, runMigrations } from '../../apps/server/src/db/migrate.ts'
import { SqliteArchiveRepository } from '../../apps/server/src/repositories/index.ts'

let testDirectory = ''
let database: DatabaseContext

beforeEach(() => {
  testDirectory = mkdtempSync(join(tmpdir(), 'draw-guess-db-test-'))
  database = createDatabase(join(testDirectory, 'test.db'))
})

afterEach(() => {
  database.close()
  rmSync(testDirectory, { recursive: true, force: true })
})

describe('SQLite 迁移与事务边界', () => {
  it('全新库应用基线迁移且重复运行幂等', () => {
    runMigrations(database)
    runMigrations(database)
    const versions = database.connection
      .prepare('SELECT version FROM schema_version ORDER BY version')
      .all()
    expect(versions).toHaveLength(MIGRATIONS.length)
  })

  it('基线 schema 不含废弃列与冗余索引', () => {
    runMigrations(database)
    const db = database.connection
    const columns = db.prepare('PRAGMA table_info(players)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).not.toContain('room_id')
    expect(columns.map((column) => column.name)).not.toContain('token')
    expect(columns.map((column) => column.name)).toContain('token_digest')
    // token_digest 的唯一性由 UNIQUE 自动索引保证，不存在多余的显式索引。
    const indexNames = (
      db.prepare('PRAGMA index_list(players)').all() as Array<{ name: string }>
    ).map((index) => index.name)
    expect(indexNames).not.toContain('idx_players_token')
    expect(indexNames).not.toContain('idx_players_token_digest')
    expect(indexNames).not.toContain('idx_players_room')
    expect(indexNames.some((name) => name.startsWith('sqlite_autoindex_players'))).toBe(true)
  })

  it('检测到旧版本数据库时抛错提示删库', () => {
    const db = database.connection
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `)
    db.prepare('INSERT INTO schema_version(version, name, applied_at) VALUES (?, ?, ?)').run(
      7,
      'drop-player-room-column',
      1,
    )
    expect(() => runMigrations(database)).toThrow(/旧版本数据库/)
  })

  it('战报从表写入失败时回滚整局，重复归档保持单行并更新结果', () => {
    runMigrations(database)
    const db = database.connection
    const repository = new SqliteArchiveRepository(database)
    const archive = {
      id: 'game-1',
      roomId: 'room-1',
      startedAt: 1,
      finishedAt: 2,
      totalRounds: 1,
      finalRanking: '[]',
    }
    expect(() =>
      repository.saveGame(archive, [
        {
          gameId: 'missing-parent',
          playerId: 'player-1',
          nickname: '玩家',
          avatarId: '01',
          rank: 1,
          score: 10,
          stats: '{}',
        },
      ]),
    ).toThrow()
    expect(db.prepare('SELECT COUNT(*) AS count FROM game_archive').get()).toMatchObject({
      count: 0,
    })

    const result = {
      gameId: archive.id,
      playerId: 'player-1',
      nickname: '玩家',
      avatarId: '01',
      rank: 1,
      score: 10,
      stats: '{}',
    }
    repository.saveGame(archive, [result])
    repository.saveGame({ ...archive, finishedAt: 3 }, [{ ...result, score: 20 }])
    expect(db.prepare('SELECT COUNT(*) AS count FROM game_archive').get()).toMatchObject({
      count: 1,
    })
    expect(db.prepare('SELECT score FROM game_results').get()).toMatchObject({ score: 20 })
  })
})
