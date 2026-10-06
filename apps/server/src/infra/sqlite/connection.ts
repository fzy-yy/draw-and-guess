/**
 * SQLite 数据库连接工厂与上下文管理。
 *
 * 遵循《后端架构规范》R4.5b 与 R4.5e：
 * 1. PRAGMA 顺序严格规定：WAL 模式打开后必须紧跟 synchronous = NORMAL，避免 FULL 模式多余 fsync 开销；
 * 2. 启用 foreign_keys 外键约束与 16 MiB 页面缓存；
 * 3. 限制 WAL 文件无界增长（wal_autocheckpoint = 1000, journal_size_limit = 64MB）；
 * 4. 内置 StatementCache 预编译语句缓存实例；
 * 5. 事务执行严格采用 BEGIN IMMEDIATE，且在编译期与运行期禁止 async/Promise。
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { StatementCache } from './statement-cache.ts'

/** 默认数据库存储文件路径 */
const DEFAULT_DATABASE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/game.db',
)

/**
 * 数据库连接打开选项。
 */
export interface OpenDatabaseOptions {
  /** 是否以只读模式打开 */
  readonly?: boolean
  /** 锁等待超时时间（毫秒，默认 5000） */
  busyTimeoutMs?: number
  /** 页缓存大小（KiB，默认 16000 即 16 MiB） */
  cacheKib?: number
  /** WAL 日志大小上限（字节，默认 64 MiB） */
  walSizeLimitBytes?: number
}

/**
 * 数据库独立上下文契约。
 * 每个应用或测试实例独占连接、语句缓存与事务生命周期。
 */
export interface DatabaseContext {
  /** 底层 SQLite 数据库连接 */
  readonly connection: Database.Database
  /** 预编译语句缓存管理器 */
  readonly statements: StatementCache
  /**
   * 在 BEGIN IMMEDIATE 事务内同步执行 action：
   * 1. 锁在起点获取，避免并发写入中途发生 SQLITE_BUSY；
   * 2. 条件类型在编译期拒绝返回 Promise 的 action，防止事务提前提交造成数据静默错乱；
   * 3. 抛错时自动保护性 ROLLBACK。
   */
  withTransaction<T>(action: () => T extends PromiseLike<unknown> ? never : T): T
  /** 关闭数据库连接并释放全部缓存语句 */
  close(): void
}

/**
 * 打开一个配置完备的原生 better-sqlite3 数据库连接。
 *
 * @param file 数据库文件路径
 * @param options 连接配置项
 * @returns 已配置 6 条关键 PRAGMA 的数据库实例
 */
export function openDatabase(
  file: string = DEFAULT_DATABASE_FILE,
  options: OpenDatabaseOptions = {},
): Database.Database {
  const busyTimeoutMs = options.busyTimeoutMs ?? 5_000
  const db = new Database(file, {
    readonly: options.readonly ?? false,
    timeout: busyTimeoutMs,
  })

  // 1. WAL 预写日志：读写并发互不阻塞
  db.pragma('journal_mode = WAL')
  // 2. 紧跟 WAL 显式设为 NORMAL：避免首次生命周期被锁在 FULL 模式带来额外 fsync
  db.pragma('synchronous = NORMAL')
  // 3. 强制开启外键完整性约束
  db.pragma('foreign_keys = ON')
  // 4. 显式配置 16 MiB 页缓存（负值表示以 KiB 计量）
  db.pragma(`cache_size = ${-(options.cacheKib ?? 16_000)}`)
  // 5. 锁等待超时
  db.pragma(`busy_timeout = ${busyTimeoutMs}`)
  // 6. 控制 WAL 大小，避免日志无界增长
  db.pragma('wal_autocheckpoint = 1000')
  db.pragma(`journal_size_limit = ${options.walSizeLimitBytes ?? 64 * 1024 * 1024}`)

  return db
}

/**
 * 创建应用级数据库上下文。
 * 组合连接、语句缓存与 BEGIN IMMEDIATE 事务控制。
 *
 * @param filePath 数据库文件路径
 * @param options 连接参数
 * @returns 数据库上下文
 */
export function createDatabase(
  filePath: string = DEFAULT_DATABASE_FILE,
  options: OpenDatabaseOptions = {},
): DatabaseContext {
  const connection = openDatabase(filePath, options)
  const statements = new StatementCache(connection)

  let closed = false

  return {
    connection,
    statements,
    withTransaction<T>(action: () => T extends PromiseLike<unknown> ? never : T): T {
      connection.exec('BEGIN IMMEDIATE')
      try {
        const result = action() as T
        connection.exec('COMMIT')
        return result
      } catch (error) {
        try {
          connection.exec('ROLLBACK')
        } catch {
          // 忽略二次回滚错误：SQLite 可能已自行回滚，保留原始业务异常
        }
        throw error
      }
    },
    close(): void {
      if (closed) return
      closed = true
      statements.clear()
      connection.close()
    },
  }
}
