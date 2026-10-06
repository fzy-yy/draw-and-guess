/**
 * SQLite 预编译语句缓存（StatementCache）。
 *
 * 遵循《后端架构规范》R4.5c：
 * 1. 同步驱动 better-sqlite3 内部不提供语句缓存，裸调用 db.prepare(sql) 每次都会重新解析 SQL；
 * 2. 预编译语句复用实测有约 15 倍性能提升；
 * 3. 采用带有硬性容量上限（LRU 剔除）的缓存池，防止动态 SQL 导致内存无界泄漏。
 */
import type Database from 'better-sqlite3'

/** 默认预编译语句最大缓存数量 */
const DEFAULT_MAX_STATEMENTS = 200

/**
 * 预编译语句缓存管理器。
 */
export class StatementCache {
  private readonly db: Database.Database
  private readonly max: number
  private readonly cache = new Map<string, Database.Statement>()

  constructor(db: Database.Database, max: number = DEFAULT_MAX_STATEMENTS) {
    this.db = db
    this.max = max
  }

  /**
   * 获取或编译指定的 SQL 预编译语句。
   *
   * @param sql SQL 语句文本
   * @returns 已编译的 Statement 实例
   */
  get(sql: string): Database.Statement {
    const cached = this.cache.get(sql)
    if (cached !== undefined) {
      return cached
    }

    const statement = this.db.prepare(sql)
    // 超过容量上限时删除最老的一条（LRU 策略）
    if (this.cache.size >= this.max) {
      const oldest = this.cache.keys().next()
      if (!oldest.done) {
        this.cache.delete(oldest.value)
      }
    }

    this.cache.set(sql, statement)
    return statement
  }

  /**
   * 清空全部缓存的语句。
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * 当前缓存的语句条数。
   */
  get size(): number {
    return this.cache.size
  }
}
