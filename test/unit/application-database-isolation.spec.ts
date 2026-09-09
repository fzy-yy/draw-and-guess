import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApplication, type RunningApplication } from '../../apps/server/src/app.ts'
import { SILENT_LOGGER } from '../../apps/server/src/errors.ts'
import { createMemoryVocabularyRegistry } from './helpers/mini-vocabulary.ts'

const temporaryDirectories: string[] = []
const runningApplications: RunningApplication[] = []

afterEach(async () => {
  await Promise.all(runningApplications.splice(0).map((application) => application.close()))
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function listen(application: RunningApplication): Promise<void> {
  return new Promise((resolve, reject) => {
    application.httpServer.once('error', reject)
    application.httpServer.listen(0, '127.0.0.1', () => {
      application.httpServer.off('error', reject)
      resolve()
    })
  })
}

describe('应用数据库实例隔离', () => {
  it('同一进程并行创建两个应用时，各自迁移、仓储和关闭生命周期互不污染', async () => {
    const root = mkdtempSync(join(tmpdir(), 'draw-guess-app-isolation-'))
    temporaryDirectories.push(root)
    const clientDist = join(root, 'dist')
    mkdirSync(clientDist)
    writeFileSync(join(clientDist, 'index.html'), '<!doctype html><title>test</title>')

    const applicationOptions = (name: string) => ({
      dbFile: join(root, `${name}.db`),
      clientDist,
      vocabulary: createMemoryVocabularyRegistry(),
      logger: SILENT_LOGGER,
    })
    const [first, second] = await Promise.all([
      createApplication(applicationOptions('first')),
      createApplication(applicationOptions('second')),
    ])
    runningApplications.push(first, second)

    first.service.repositories.players.upsert({
      id: 'player-first',
      tokenDigest: 'shared-token',
      nickname: '第一库',
      avatarId: '01',
      discoverable: true,
      acceptsInvites: true,
      connected: false,
      joinedAt: 1,
    })
    second.service.repositories.players.upsert({
      id: 'player-second',
      tokenDigest: 'shared-token',
      nickname: '第二库',
      avatarId: '02',
      discoverable: true,
      acceptsInvites: true,
      connected: false,
      joinedAt: 2,
    })

    expect(
      first.service.repositories.players.consumeRecoveryToken('shared-token', 'first-next')?.id,
    ).toBe('player-first')
    expect(
      second.service.repositories.players.consumeRecoveryToken('shared-token', 'second-next')?.id,
    ).toBe('player-second')

    await Promise.all([listen(first), listen(second)])
    const firstClose = first.close()
    expect(first.close()).toBe(firstClose)
    await firstClose
    expect(first.httpServer.listening).toBe(false)
    expect(second.httpServer.listening).toBe(true)

    await second.close()
    await second.close()
    expect(second.httpServer.listening).toBe(false)
  })
})
