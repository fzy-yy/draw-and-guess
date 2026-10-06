import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const serviceFiles = [
  '../../apps/server/src/modules/session/session.service.ts',
  '../../apps/server/src/modules/room/room.service.ts',
  '../../apps/server/src/application/room-persistence-coordinator.ts',
  '../../apps/server/src/modules/vocabulary/candidate-selector.ts',
]

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

describe('拆分服务依赖边界', () => {
  it('子服务不反向导入 GameService，也不互相引用', () => {
    for (const file of serviceFiles) {
      const content = source(file)
      expect(content).not.toMatch(/from ['"].*game-service/)
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

  it('handlers 继续只依赖 GameService Facade', () => {
    const handlers = ['session.ts', 'room.ts', 'game.ts', 'chat.ts', 'draw.ts']
    for (const handler of handlers) {
      const content = source(`../../apps/server/src/handlers/${handler}`)
      expect(content).toContain("import type { GameService } from '../game-service.ts'")
      expect(content).not.toMatch(/session-service|room-membership-service|candidate-selector/)
    }
  })
})
