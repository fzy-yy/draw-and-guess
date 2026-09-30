/**
 * SQLite 实例上下文。每个应用显式拥有自己的连接、事务边界和关闭生命周期，
 * 因此同一进程可安全创建多个指向不同文件的服务实例。
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_DATABASE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/game.db',
)

export interface DatabaseContext {
  readonly connection: Database.Database
  /**
   * 在 BEGIN IMMEDIATE 事务内同步执行 action：action 抛错或 COMMIT 失败都回滚并抛出原始错误。
   *
   * action 的返回值经条件类型闸门过滤——返回 Promise 的 action 会被映射为 never 而无法通过编译。
   * 原因：better-sqlite3 是同步驱动，异步 action 的 Promise 在 COMMIT 之后才 settle，
   * 业务失败时事务早已提交，形成「看似回滚、实则写入」的静默数据错误，故在类型层面直接拒绝。
   */
  withTransaction<T>(action: () => T extends PromiseLike<unknown> ? never : T): T
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
    withTransaction<T>(action: () => T extends PromiseLike<unknown> ? never : T): T {
      connection.exec('BEGIN IMMEDIATE')
      try {
        // 条件类型无法在实现侧还原为 T：这里的断言只表达「闸门已保证 action 返回同步值」。
        const result = action() as T
        connection.exec('COMMIT')
        return result
      } catch (error) {
        // 无论 action 抛错还是 COMMIT 失败，都要把连接拉回空闲态：COMMIT 失败（如磁盘 I/O 错误）
        // 时事务可能仍未结束，必须补一次保护性 ROLLBACK；而 SQLite 在部分失败路径上会自行回滚，
        // 此时 ROLLBACK 会再报「无活动事务」，忽略它并保留原始错误，避免掩盖真正的失败原因。
        try {
          connection.exec('ROLLBACK')
        } catch {
          // 忽略：SQLite 可能已自动回滚，原始错误优先。
        }
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
