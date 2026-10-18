/**
 * 接龙终局、提前结束与战报落盘（工单 08；S25 / S33 / S34 / S37 / S38 / S59 / S60）。
 *
 * 覆盖四件事：
 * - 全部链走完进终局：视图只给排名 / 分数 / 接龙口径统计，无称号、无链明细（S33 / S77）；
 * - 结算退出状态机与经典同口径（docs/game-result-exit.md）：最短展示期、房主全局返回、自动返回上限，
 *   回到等待后「再来一局」仍是接龙模式（S60）；
 * - 对局期房主可提前结束（直接终局、按当前分数结算、战报记「房主提前结束」），展示 / 投票期仍拒绝（S34 / S38 / S12）；
 * - 战报新增 `mode` 列（追加迁移、历史行默认 classic），接龙局写 relay，且只存最终排名与玩家总分（S25 / S59）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ERROR_CODES, RoomSnapshotSchema, type RelayVoteChoice } from '@draw-guess/shared'
import { serverStrings } from '@draw-guess/strings'
import { APP_CONFIG } from '../../apps/server/src/config/index.ts'
import { createDatabase, type DatabaseContext } from '../../apps/server/src/db/index.ts'
import { MIGRATIONS, runMigrations } from '../../apps/server/src/db/migrate.ts'
import { SqliteArchiveRepository } from '../../apps/server/src/repositories/index.ts'
import { errorCodeOf, startRelayGame } from './helpers/relay-game-fixture.ts'
import { testRoomSettings } from './helpers/game-harness.ts'

/** 全投赞同的整局（每条链都匹配成功：4 人局每条链 4 张赞同票 → 每人每条链 +40）。 */
function playAllAgree() {
  const scenario = startRelayGame({ playerCount: 4 })
  scenario.playToResult(() => 'agree' as RelayVoteChoice)
  return scenario
}

describe('接龙终局载荷（S33 / S77）', () => {
  it('终局视图只有名次、分数与接龙口径统计：无称号、无链明细、无票行（S33）', () => {
    const scenario = playAllAgree()
    const perVote = APP_CONFIG.relay.scorePerAgreeVote
    const view = scenario.snapshotOf(scenario.host.playerId).relay
    if (!view) throw new Error('终局缺少 relay 视图')

    expect(scenario.room.phase).toBe('game_result')
    expect(view.phase).toBe('game_result')
    // 每人 4 条链全部匹配：4 条 × 4 张赞同票 × 10 分
    for (const entry of view.finalRanking ?? []) {
      expect(Object.keys(entry).sort()).toEqual(
        ['agreeVotes', 'avatarId', 'chainCount', 'id', 'nickname', 'rank', 'score'].sort(),
      )
      expect(entry.score).toBe(4 * 4 * perVote)
      expect(entry.chainCount).toBe(4)
      expect(entry.agreeVotes).toBe(16)
    }
    // 终局快照里没有任何链明细：画作、答案、票行、票行单元全部不下发
    const serialized = JSON.stringify(scenario.snapshotOf(scenario.host.playerId))
    expect(view.showcase).toBeUndefined()
    expect(serialized).not.toContain('"votes"')
    expect(serialized).not.toContain('"strokes"')
    expect(serialized).not.toContain('"prompt"')
    // 也没有任何称号类字段（S33：接龙没有称号数据源）
    for (const forbidden of ['accolade', 'title', 'badge', 'bestChain'])
      expect(serialized).not.toContain(forbidden)
    expect(RoomSnapshotSchema.safeParse(scenario.snapshotOf(scenario.host.playerId)).success).toBe(
      true,
    )
  })

  it('结算退出与经典同口径：最短展示期后房主可全局返回，自动返回上限到期无条件回等待（S60）', () => {
    const scenario = playAllAgree()
    const minimumMs = APP_CONFIG.game.gameResultMinSeconds * 1_000
    const guest = scenario.players[1]
    if (!guest) throw new Error('场景缺少玩家')

    // 最短展示期内：任何人的全局返回都不解锁
    expect(scenario.snapshotOf(scenario.host.playerId).relay?.gameResultMinEndsAt).toBe(
      scenario.relay.phaseStartedAt + minimumMs,
    )
    expect(scenario.snapshotOf(scenario.host.playerId).relay?.canReturnWaiting).toBe(false)
    scenario.harness.runtime.advance(minimumMs - 1)
    expect(scenario.snapshotOf(scenario.host.playerId).relay?.canReturnWaiting).toBe(false)
    // 到点后房主解锁（普通成员永远拿不到这个能力）
    scenario.harness.runtime.advance(1)
    expect(scenario.snapshotOf(scenario.host.playerId).relay?.canReturnWaiting).toBe(true)
    expect(scenario.snapshotOf(guest.playerId).relay?.canReturnWaiting).toBe(false)

    // 房主「再来一局」→ 直接回等待；模式仍是接龙（S60），且本局对局秘密已清场
    scenario.harness.backend.gameplay.returnWaiting(scenario.host.playerId)
    expect(scenario.room.phase).toBe('waiting')
    expect(scenario.room.gameMode).toBe('relay')
    expect(scenario.room.relay).toBeUndefined()
    // 到等待后重复请求按成功处理（迟到 / 重复请求不报错，与经典同口径）
    scenario.harness.backend.gameplay.returnWaiting(scenario.host.playerId)

    // 再开一局仍是接龙：链数组重新建立、分数清零（回等待会清掉全员准备位，需重新准备）
    let latest = scenario.snapshotOf(scenario.host.playerId)
    for (const member of scenario.players.slice(1)) {
      latest = scenario.harness.backend.room.setReady(member.playerId, true)
    }
    scenario.harness.backend.gameplay.startGame(scenario.host.playerId, latest.stateVersion)
    scenario.harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)
    expect(scenario.room.phase).toBe('relay_choose')
    expect(scenario.room.relay?.chains).toHaveLength(4)
    for (const member of scenario.room.members) expect(member.score).toBe(0)
  })

  it('自动返回上限到期后无条件回等待（无人点击也能离场）', () => {
    const scenario = playAllAgree()
    const autoReturnMs = Math.max(
      APP_CONFIG.game.gameResultMinSeconds * 1_000,
      APP_CONFIG.game.gameResultAutoReturnSeconds * 1_000,
    )

    scenario.harness.runtime.advance(autoReturnMs - 1)
    expect(scenario.room.phase).toBe('game_result')
    scenario.harness.runtime.advance(1)
    expect(scenario.room.phase).toBe('waiting')
    expect(scenario.room.relay).toBeUndefined()
  })
})

describe('对局期房主提前结束（S34 / S38 / S12）', () => {
  it('选词 / 作画 / 猜词期都能提前结束：直接终局、按当前分数结算（全员 0 分）', () => {
    const scenario = startRelayGame()
    // 选词期（步 1）
    expect(scenario.room.phase).toBe('relay_choose')
    scenario.harness.backend.gameplay.endEarly(scenario.host.playerId)

    expect(scenario.room.phase).toBe('game_result')
    // 接龙没有任何链走过投票 → 全员 0 分，「按当前分数结算」不会凭空加分
    for (const member of scenario.room.members) expect(member.score).toBe(0)
    const ranking = scenario.snapshotOf(scenario.host.playerId).relay?.finalRanking ?? []
    expect(ranking).toHaveLength(4)
    for (const entry of ranking) expect(entry.score).toBe(0)
    // 战报照常落盘并记下结束原因（S38）
    const archive = scenario.harness.repositories.archive.games.at(-1)
    expect(archive?.archive.reason).toBe(serverStrings.notices.endEarlyByHost)
    expect(archive?.archive.mode).toBe('relay')
    // 终局通知也播了（S65 的关键节点）
    expect(scenario.notices()).toContain(serverStrings.notices.endEarlyByHost)
  })

  it('展示期与投票期仍拒绝提前结束（S12），且不动现场', () => {
    const scenario = startRelayGame()
    scenario.playToShowcase()
    const host = scenario.host
    // 展示期
    expect(errorCodeOf(() => scenario.harness.backend.gameplay.endEarly(host.playerId))).toBe(
      ERROR_CODES.INVALID_PHASE,
    )
    expect(scenario.room.phase).toBe('relay_showcase')
    // 投票期
    scenario.finishShowcaseChain()
    expect(scenario.room.phase).toBe('relay_vote')
    const before = scenario.relay.phaseEndsAt
    expect(errorCodeOf(() => scenario.harness.backend.gameplay.endEarly(host.playerId))).toBe(
      ERROR_CODES.INVALID_PHASE,
    )
    expect(scenario.room.phase).toBe('relay_vote')
    expect(scenario.relay.phaseEndsAt).toBe(before)
  })

  it('普通成员不能提前结束（只有房主可以）', () => {
    const scenario = startRelayGame()
    const guest = scenario.players[1]
    if (!guest) throw new Error('场景缺少玩家')

    expect(errorCodeOf(() => scenario.harness.backend.gameplay.endEarly(guest.playerId))).toBe(
      ERROR_CODES.FORBIDDEN,
    )
    expect(scenario.room.phase).toBe('relay_choose')
  })
})

describe('主动退出本局（S37）', () => {
  it('退出者保留冻结成绩卡并留在终局榜单，链位由服务端代交', () => {
    const scenario = startRelayGame({ playerCount: 4 })
    const quitter = scenario.players[1]
    if (!quitter) throw new Error('场景缺少玩家')
    const quitterProfile = scenario.harness.backend.requirePlayer(quitter.playerId).profile

    scenario.harness.backend.room.leaveGame(quitter.playerId)
    // 链位仍在（代交口径）：本局链阵容不变，退局者只是不再自己动手
    expect(scenario.relay.chains.map((chain) => chain.originPlayerId)).toContain(quitter.playerId)

    scenario.playToResult(() => 'agree' as RelayVoteChoice)

    // 榜单里仍有他，资料取冻结的 leftProfile
    const ranking = scenario.snapshotOf(scenario.host.playerId).relay?.finalRanking ?? []
    const entry = ranking.find((candidate) => candidate.id === quitter.playerId)
    expect(entry?.nickname).toBe(quitterProfile.nickname)
    expect(entry?.avatarId).toBe(quitterProfile.avatarId)
    expect(ranking).toHaveLength(4)
    // 他缺席的那一棒由服务端代交，链照常走完并计分：4 人局全员参与全部链，
    // 每条链 3 张赞同 + 退局者补的 1 张不赞同 → 每条链仍匹配成功（3×10），四条链共 120。
    expect(entry?.score).toBe(4 * 3 * APP_CONFIG.relay.scorePerAgreeVote)
    expect(entry?.agreeVotes).toBe(4 * 3)
  })
})

describe('战报 mode 列（S25 / S59）', () => {
  it('接龙局写 relay、经典局写 classic，且仍只存最终排名与玩家总分', () => {
    const scenario = startRelayGame({ playerCount: 4 })
    scenario.harness.backend.gameplay.endEarly(scenario.host.playerId)

    const games = scenario.harness.repositories.archive.games
    expect(games).toHaveLength(1)
    const record = games[0]
    if (!record) throw new Error('战报未落盘')
    expect(record.archive.mode).toBe('relay')
    // 只存排名与总分：链条数记在 total_rounds，不含任何链明细 / 画布 / 投票
    expect(record.archive.totalRounds).toBe(4)
    expect(record.results).toHaveLength(4)
    for (const result of record.results)
      expect(Object.keys(result).sort()).toEqual([
        'avatarId',
        'gameId',
        'nickname',
        'playerId',
        'rank',
        'score',
        'stats',
      ])
    expect(JSON.stringify(record)).not.toContain('votes')
    expect(JSON.stringify(record)).not.toContain('strokes')
  })

  it('经典房间的对局战报保持 classic（既有结算路径零影响）', () => {
    const harness = startRelayGame({ playerCount: 4 }).harness
    // 不复用接龙场景：另开一个经典房（走既有结算路径）后落盘
    const host = harness.register('经典房主')
    const guest = harness.register('经典客人')
    const room = harness.backend.room.createRoom(host.playerId, {
      name: '经典测试房间',
      visibility: 'public',
      settings: testRoomSettings(),
    })
    harness.backend.room.joinRoom(guest.playerId, room.id)
    const ready = harness.backend.room.setReady(guest.playerId, true)
    harness.backend.gameplay.startGame(host.playerId, ready.stateVersion)
    harness.runtime.advance(APP_CONFIG.game.startingCountdownSeconds * 1_000)
    harness.backend.gameplay.endEarly(host.playerId)

    const record = harness.repositories.archive.games.at(-1)
    expect(record?.archive.mode).toBe('classic')
  })
})

describe('SQLite 迁移：game_archive.mode 列（S59）', () => {
  let testDirectory = ''
  let database: DatabaseContext

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), 'draw-guess-relay-archive-'))
    database = createDatabase(join(testDirectory, 'test.db'))
  })

  afterEach(() => {
    // 只碰系统临时目录：关闭连接后整目录删除，绝不触碰真实 game.db
    database.close()
    rmSync(testDirectory, { recursive: true, force: true })
  })

  it('新迁移只追加一列：历史行默认 classic，新库整表可写 mode', () => {
    const connection = database.connection
    // 模拟「已有 v1 基线 + 一条历史战报」的旧库：只应用 v1 并登记，再跑迁移
    const baseline = MIGRATIONS[0]
    if (!baseline) throw new Error('缺少基线迁移')
    connection.exec(baseline.up)
    connection.exec(
      `CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);`,
    )
    connection
      .prepare('INSERT INTO schema_version(version, name, applied_at) VALUES (?, ?, ?)')
      .run(baseline.version, baseline.name, 1)
    connection
      .prepare(
        `INSERT INTO game_archive(id, room_id, started_at, finished_at, total_rounds, final_ranking, reason)
         VALUES ('legacy-game', 'legacy-room', 1, 2, 1, '[]', '历史战报')`,
      )
      .run()

    runMigrations(database)

    // 历史行按迁移默认值补成 classic（不改动既有行内容）
    expect(
      connection.prepare('SELECT mode FROM game_archive WHERE id = ?').get('legacy-game'),
    ).toEqual({ mode: 'classic' })
    // 新写入的接龙战报落 relay；重复归档仍保持单行
    const repository = new SqliteArchiveRepository(database)
    repository.saveGame(
      {
        id: 'relay-game',
        roomId: 'relay-room',
        startedAt: 10,
        finishedAt: 20,
        totalRounds: 4,
        finalRanking: '[]',
        reason: '本局结束',
        mode: 'relay',
      },
      [],
    )
    repository.saveGame(
      {
        id: 'relay-game',
        roomId: 'relay-room',
        startedAt: 10,
        finishedAt: 30,
        totalRounds: 4,
        finalRanking: '[]',
        reason: '本局结束',
        mode: 'relay',
      },
      [],
    )
    expect(connection.prepare('SELECT COUNT(*) AS count FROM game_archive').get()).toMatchObject({
      count: 2,
    })
    expect(
      connection.prepare('SELECT mode FROM game_archive WHERE id = ?').get('relay-game'),
    ).toEqual({ mode: 'relay' })
  })

  it('迁移版本表登记了新版本，重复运行幂等', () => {
    runMigrations(database)
    runMigrations(database)
    const versions = database.connection
      .prepare('SELECT version FROM schema_version ORDER BY version')
      .all()
    expect(versions).toHaveLength(MIGRATIONS.length)
    expect(MIGRATIONS.length).toBe(2)
  })
})
