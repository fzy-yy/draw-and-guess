import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AVATAR_IDS,
  DRAW_SECONDS_OPTIONS,
  DRAWING_PROTOCOL_LIMITS,
  PLAYER_PROTOCOL_LIMITS,
  PRIVATE_ROOM_CODE,
  PROTOCOL_VERSION,
  RELAY_CHOOSE_SECONDS_OPTIONS,
  RELAY_DRAW_SECONDS_OPTIONS,
  RELAY_GUESS_SECONDS_OPTIONS,
  ROOM_RULE_LIMITS,
} from '@draw-guess/shared'
import { APP_CONFIG } from '@draw-guess/config'

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('monorepo 包边界', () => {
  it('shared 源码不越界导入 config、strings 或应用目录', () => {
    const sharedRoot = fileURLToPath(new URL('../../packages/shared/src', import.meta.url))
    for (const file of sourceFiles(sharedRoot)) {
      const content = readFileSync(file, 'utf8')
      expect(content).not.toMatch(/(?:\.\.\/){2,}|@draw-guess\/(?:config|strings)|apps\//u)
    }
  })

  it('公开配置直接复用 shared 的协议约束', () => {
    expect(APP_CONFIG.app.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(APP_CONFIG.player.avatarIds).toBe(AVATAR_IDS)
    expect(APP_CONFIG.player.nicknameMinLength).toBe(PLAYER_PROTOCOL_LIMITS.nicknameMinLength)
    expect(APP_CONFIG.player.nicknameMaxLength).toBe(PLAYER_PROTOCOL_LIMITS.nicknameMaxLength)
    expect(APP_CONFIG.room.privateCodeLength).toBe(PRIVATE_ROOM_CODE.length)
    expect(APP_CONFIG.game.roundsPerPlayer.min).toBe(ROOM_RULE_LIMITS.roundsPerPlayer.min)
    expect(APP_CONFIG.game.drawSeconds.options).toBe(DRAW_SECONDS_OPTIONS)
    expect(APP_CONFIG.drawing.colorPattern).toBe(DRAWING_PROTOCOL_LIMITS.colorPattern)
    expect(APP_CONFIG.drawing.width.min).toBe(DRAWING_PROTOCOL_LIMITS.width.min)
    expect(APP_CONFIG.drawing.maxPointsPerBatch).toBe(DRAWING_PROTOCOL_LIMITS.maxPointsPerBatch)
    // 接龙三时长的档位白名单同样只有协议常量一份来源，默认值落在配置包（S17 / S39）
    expect(APP_CONFIG.relay.chooseSeconds.options).toBe(RELAY_CHOOSE_SECONDS_OPTIONS)
    expect(APP_CONFIG.relay.drawSeconds.options).toBe(RELAY_DRAW_SECONDS_OPTIONS)
    expect(APP_CONFIG.relay.guessSeconds.options).toBe(RELAY_GUESS_SECONDS_OPTIONS)
    expect(APP_CONFIG.relay.chooseSeconds.options).toContain(APP_CONFIG.relay.chooseSeconds.default)
    expect(APP_CONFIG.relay.drawSeconds.options).toContain(APP_CONFIG.relay.drawSeconds.default)
    expect(APP_CONFIG.relay.guessSeconds.options).toContain(APP_CONFIG.relay.guessSeconds.default)
  })

  it('浏览器配置包不声明服务端限频、数据库路径或清理策略', () => {
    const configSources = [
      'app.ts',
      'drawing.ts',
      'index.ts',
      'player.ts',
      'public.ts',
      'room.ts',
      'vocabulary.ts',
    ]
      .map((file) => source(`../../packages/config/src/${file}`))
      .join('\n')
    expect(configSources).not.toMatch(
      /reconnectGraceMs|guessEventsPerSecond|requestEventsPerSecond|idempotencyCacheMax|dbPath|maxDrawEventsPerSecond/u,
    )
  })

  it('公开推送 DTO 由 schema 推导，Secret 与仓储模型不依赖 Zod', () => {
    for (const file of ['common.ts', 'drawing.ts', 'gameplay.ts', 'invite.ts', 'room.ts']) {
      expect(source(`../../packages/shared/src/types/${file}`)).toContain('z.infer')
    }
    const handwrittenDomain = [
      source('../../apps/server/src/models.ts'),
      source('../../apps/server/src/repositories/player-repository.ts'),
      source('../../apps/server/src/repositories/archive-repository.ts'),
    ].join('\n')
    expect(handwrittenDomain).not.toMatch(/z\.infer|protocol\/push/u)
  })

  it('数据库连接没有模块级路径覆盖或全局访问器', () => {
    const databaseSource = source('../../apps/server/src/infra/sqlite/connection.ts')
    expect(databaseSource).toContain('export function createDatabase')
    expect(databaseSource).toContain('export interface DatabaseContext')
    expect(databaseSource).not.toMatch(/setDbFile|getDb|closeDb|dbFileOverride/u)
  })

  it('运行期房间保持纯内存，迁移不再包含历史房间表', () => {
    const serverRoot = fileURLToPath(new URL('../../apps/server/src', import.meta.url))
    const runtimeSources = sourceFiles(serverRoot)
      .filter(
        (file) =>
          !file.endsWith(join('infra', 'sqlite', 'migrate.ts')) &&
          !file.endsWith(join('db', 'migrate.ts')),
      )
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    expect(runtimeSources).not.toMatch(
      /RoomRepository|SqliteRoomRepository|persistRoom|saveAggregate|room_members/u,
    )
    const migrations = source('../../apps/server/src/infra/sqlite/migrate.ts')
    expect(migrations).toContain("name: 'baseline-schema'")
    expect(migrations).not.toContain('room_members')
    expect(migrations).not.toContain('CREATE TABLE IF NOT EXISTS rooms')
  })
})
