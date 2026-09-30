import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDatabase, type DatabaseContext } from '../../apps/server/src/db/index.ts'
import { MIGRATIONS, runMigrations } from '../../apps/server/src/db/migrate.ts'
import { SqliteArchiveRepository } from '../../apps/server/src/repositories/index.ts'
import { digestRecoveryToken } from '../../apps/server/src/security/recovery-token.ts'

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
  it('从旧版本升级并可重复运行迁移', () => {
    const db = database.connection
    const first = MIGRATIONS[0]!
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `)
    if (typeof first.up === 'string') db.exec(first.up)
    else first.up(db)
    db.prepare('INSERT INTO schema_version(version, name, applied_at) VALUES (?, ?, ?)').run(
      first.version,
      first.name,
      1,
    )
    runMigrations(database)
    runMigrations(database)
    const versions = db.prepare('SELECT version FROM schema_version ORDER BY version').all()
    expect(versions).toHaveLength(MIGRATIONS.length)
  })

  it('迁移 v7 删除 players 冗余索引与废弃 room_id 列', () => {
    runMigrations(database)
    const db = database.connection
    // 列层面：room_id 兼容列已删除。
    const columns = db.prepare('PRAGMA table_info(players)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).not.toContain('room_id')
    // 索引层面：显式冗余索引与死列索引均删除；token_digest 的唯一性仍由 UNIQUE 自动索引保证，
    // 唯一约束未被削弱（v1 的 idx_players_token 早在 v6 随旧表删除，同样不应出现）。
    const indexNames = (
      db.prepare('PRAGMA index_list(players)').all() as Array<{ name: string }>
    ).map((index) => index.name)
    expect(indexNames).not.toContain('idx_players_token')
    expect(indexNames).not.toContain('idx_players_token_digest')
    expect(indexNames).not.toContain('idx_players_room')
    expect(indexNames.some((name) => name.startsWith('sqlite_autoindex_players'))).toBe(true)
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

  it('升级旧库会删除从未恢复的房间表，同时保留玩家身份和完成局战报', () => {
    const db = database.connection
    for (const migration of MIGRATIONS.slice(0, 4)) {
      if (typeof migration.up === 'string') db.exec(migration.up)
      else migration.up(db)
    }
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `)
    const markApplied = db.prepare(
      'INSERT INTO schema_version(version, name, applied_at) VALUES (?, ?, ?)',
    )
    for (const migration of MIGRATIONS.slice(0, 4))
      markApplied.run(migration.version, migration.name, 1)
    db.prepare(
      `INSERT INTO players(
        id, token, nickname, avatar_id, discoverable, accepts_invites,
        connected, joined_at, room_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('player-1', 'token-1', '玩家', '01', 1, 1, 0, 1, 'legacy-room')
    db.prepare(
      `INSERT INTO rooms(
        id, name, host_id, visibility, private_code, phase, state_version,
        settings, selected_words, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('legacy-room', '旧房间', 'player-1', 'public', null, 'waiting', 1, '{', '[', 1, 1)
    db.prepare(
      `INSERT INTO room_members(
        room_id, player_id, seat_index, spectating, left_game, ready, score, joined_at, stats
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('legacy-room', 'player-1', 0, 0, 0, 0, 0, 1, '{}')
    db.prepare(
      `INSERT INTO game_archive(
        id, room_id, started_at, finished_at, total_rounds, final_ranking, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('game-1', 'legacy-room', 1, 2, 1, '[]', '完成')

    runMigrations(database)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
    expect(tables.map((table) => table.name)).not.toContain('rooms')
    expect(tables.map((table) => table.name)).not.toContain('room_members')
    // v7 已删除废弃的 room_id 兼容列：升级前写入的 legacy-room 引用随之消失。
    const playerColumns = db.prepare('PRAGMA table_info(players)').all() as Array<{ name: string }>
    expect(playerColumns.map((column) => column.name)).not.toContain('token')
    expect(playerColumns.map((column) => column.name)).not.toContain('room_id')
    expect(
      db.prepare('SELECT token_digest FROM players WHERE id = ?').get('player-1'),
    ).toMatchObject({ token_digest: digestRecoveryToken('token-1') })
    expect(db.prepare('SELECT * FROM game_archive WHERE id = ?').get('game-1')).toMatchObject({
      room_id: 'legacy-room',
      reason: '完成',
    })
  })
})
