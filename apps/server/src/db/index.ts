/**
 * SQLite 实例上下文。每个应用显式拥有自己的连接、事务边界和关闭生命周期，
 * 因此同一进程可安全创建多个指向不同文件的服务实例。
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_DATABASE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/game.db',
)

export interface DatabaseContext {
  readonly connection: Database.Database
  withTransaction<T>(action: () => T): T
  close(): void
}

/** 打开一个独立 SQLite 连接；调用方负责持有并最终关闭返回的上下文。 */
export function createDatabase(filePath: string = DEFAULT_DATABASE_FILE): DatabaseContext {
  const connection = new Database(filePath)
  connection.pragma('journal_mode = WAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('foreign_keys = ON')

  let closed = false
  return {
    connection,
    withTransaction<T>(action: () => T): T {
      connection.exec('BEGIN IMMEDIATE')
      try {
        const result = action()
        connection.exec('COMMIT')
        return result
      } catch (error) {
        connection.exec('ROLLBACK')
        throw error
      }
    },
    close(): void {
      if (closed) return
      closed = true
      connection.close()
    },
  }
}
