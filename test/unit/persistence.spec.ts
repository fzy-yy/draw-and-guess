import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeDb, getDb, setDbFile } from '../../apps/server/src/db/index.ts'
import { MIGRATIONS, runMigrations } from '../../apps/server/src/db/migrate.ts'
import {
  SqliteArchiveRepository,
  SqlitePlayerRepository,
  SqliteRoomRepository,
} from '../../apps/server/src/repositories/index.ts'
import { GameService } from '../../apps/server/src/game-service.ts'
import { SILENT_LOGGER } from '../../apps/server/src/errors.ts'
import { createMemoryVocabularyRegistry } from './helpers/mini-vocabulary.ts'
import { createFakeRuntime } from './helpers/fake-clock.ts'

let testDirectory = ''

beforeEach(() => {
  testDirectory = mkdtempSync(join(tmpdir(), 'draw-guess-db-test-'))
  setDbFile(join(testDirectory, 'test.db'))
})

afterEach(() => {
  closeDb()
  rmSync(testDirectory, { recursive: true, force: true })
})

describe('SQLite 迁移与事务边界', () => {
  it('从旧版本升级并可重复运行迁移', () => {
    const db = getDb()
    const first = MIGRATIONS[0]!
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `)
    db.exec(first.up)
    db.prepare('INSERT INTO schema_version(version, name, applied_at) VALUES (?, ?, ?)').run(
      first.version,
      first.name,
      1,
    )
    runMigrations()
    runMigrations()
    const versions = db.prepare('SELECT version FROM schema_version ORDER BY version').all()
    expect(versions).toHaveLength(MIGRATIONS.length)
  })

  it('战报从表写入失败时回滚整局，重复归档保持单行并更新结果', () => {
    runMigrations()
    const db = getDb()
    const repository = new SqliteArchiveRepository()
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

  it('启动恢复可清除包含损坏 JSON 的遗留房间记录而不解析污染领域状态', () => {
    runMigrations()
    const db = getDb()
    db.prepare(
      `INSERT INTO rooms(
        id, name, host_id, visibility, private_code, phase, state_version,
        settings, selected_words, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('broken-room', '损坏房间', 'missing-host', 'public', null, 'waiting', 1, '{', '[', 1, 1)

    const io = {
      to: () => ({ emit: () => undefined }),
      in: () => ({ emit: () => undefined }),
      emit: () => undefined,
    } as unknown as ConstructorParameters<typeof GameService>[0]
    const service = new GameService(
      io,
      createMemoryVocabularyRegistry(),
      {
        players: new SqlitePlayerRepository(),
        rooms: new SqliteRoomRepository(),
        archive: new SqliteArchiveRepository(),
      },
      SILENT_LOGGER,
      createFakeRuntime(),
    )
    expect(() => service.recoverOnStartup()).not.toThrow()
    expect(db.prepare('SELECT COUNT(*) AS count FROM rooms').get()).toMatchObject({ count: 0 })
  })
})
