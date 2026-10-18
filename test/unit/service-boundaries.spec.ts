import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const serviceFiles = [
  '../../apps/server/src/modules/session/session.service.ts',
  '../../apps/server/src/modules/room/room.service.ts',
  '../../apps/server/src/application/room-persistence-coordinator.ts',
  '../../apps/server/src/modules/vocabulary/candidate-selector.ts',
]

/** 已被删除的平行实现：任何一条复活都意味着「两个装配点」的问题回来了。 */
const RETIRED_PATHS = [
  '../../apps/server/src/game-service.ts',
  '../../apps/server/src/handlers',
  '../../apps/server/src/ws/handler-kit.ts',
  '../../apps/server/src/ws/contracts.ts',
]

/** 只允许在装配根里执行一次的具体实现构造（docs/adr/0064-single-backend-assembly.md）。 */
const ASSEMBLY_ONLY = [
  'SessionService',
  'RoomService',
  'GameplayService',
  'RelayService',
  'ChatService',
  'DrawingService',
  'InviteService',
  'RoomVocabularyService',
  'RoundMachine',
  'RelayMachine',
  'SnapshotBuilder',
  'RoomPublisher',
  'RoomPersistenceCoordinator',
  'DomainContext',
]

const serverSrc = fileURLToPath(new URL('../../apps/server/src/', import.meta.url))

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

function exists(relativePath: string): boolean {
  try {
    statSync(fileURLToPath(new URL(relativePath, import.meta.url)))
    return true
  } catch {
    return false
  }
}

function serverSourceFiles(directory = serverSrc): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = `${directory}${name}`
    if (statSync(path).isDirectory()) return serverSourceFiles(`${path}/`)
    return path.endsWith('.ts') ? [path] : []
  })
}

describe('拆分服务依赖边界', () => {
  it('子服务不反向导入装配根，也不互相引用', () => {
    for (const file of serviceFiles) {
      const content = source(file)
      expect(content).not.toMatch(/from ['"].*(game-service|backend)\.ts/)
      for (const sibling of serviceFiles) {
        if (sibling === file) continue
        expect(content).not.toContain(sibling.split('/').at(-1)!)
      }
    }
  })

  it('有副作用的模块公开最小 Context，候选选择器保持纯函数', () => {
    expect(source(serviceFiles[0]!)).toContain('export interface SessionServiceContext')
    expect(source(serviceFiles[1]!)).toContain('export interface RoomServiceContext')
    expect(source(serviceFiles[2]!)).toContain('export interface RoomPersistenceCoordinatorContext')
    const candidate = source(serviceFiles[3]!)
    expect(candidate).toContain('export function selectDiverseCandidates')
    expect(candidate).not.toMatch(/GameService|Date\.now|Math\.random|RuntimeDependencies/)
  })

  it('平行请求面保持删除状态：GameService / handlers / ws 孪生不得复活', () => {
    for (const path of RETIRED_PATHS) expect(exists(path)).toBe(false)

    // 也不能换名字复活：全仓不得再出现对它们的引用。
    for (const file of serverSourceFiles()) {
      const content = readFileSync(file, 'utf8')
      expect(content).not.toMatch(/from ['"].*game-service/)
      expect(content).not.toMatch(/from ['"].*\/handlers\//)
      expect(content).not.toMatch(/from ['"].*ws\/handler-kit/)
      expect(content).not.toMatch(/from ['"].*ws\/contracts/)
    }
  })

  it('具体实现只在装配根里构造一次', () => {
    for (const className of ASSEMBLY_ONLY) {
      const pattern = new RegExp(`new ${className}\\(`, 'g')
      const hits = serverSourceFiles().filter((file) => readFileSync(file, 'utf8').match(pattern))
      expect(hits.map((file) => file.slice(serverSrc.length))).toEqual(['backend.ts'])
    }
  })
})
