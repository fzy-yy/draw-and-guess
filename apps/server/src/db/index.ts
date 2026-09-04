/**
 * SQLite 数据库连接管理（better-sqlite3）。
 *
 * 本项目是局域网单进程游戏服务，权威状态本应全在内存；但为了「重启不丢数据」，
 * 引入 SQLite 做本地持久化：只持久化低频关键态（身份、房间配置、战绩），
 * 高频瞬态（画布笔画、聊天消息、计时器）仍留在内存，避免逐事件写库拖垮性能。
 *
 * 采用 better-sqlite3（同步 API、性能好、自带常见平台预编译二进制），并开启 WAL 模式：
 * - WAL 让读不阻塞写、写不阻塞读，符合游戏服务「读多写少」的场景；
 * - 单进程单写者，天然满足 SQLite 的库级写锁限制，无需额外并发控制。
 *
 * 路径固定落在 apps/server/data/game.db（运行期生成，已被 .gitignore 忽略）。
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 数据库文件默认目录：apps/server/data/。 */
const DEFAULT_DB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data')

/** 惰性单例连接：只在首次 getDb() 时打开，避免模块加载即建库/占连接。 */
let db: Database.Database | undefined

/** 获取（必要时创建）SQLite 连接。开启 WAL 与外键约束。 */
export function getDb(): Database.Database {
  if (db) return db
  const database = new Database(path.join(DEFAULT_DB_DIR, 'game.db'))
  // WAL：读写互不阻塞；busy_timeout 避免并发写时立即抛错。
  database.pragma('journal_mode = WAL')
  database.pragma('busy_timeout = 5000')
  // 开启外键约束，保证房间成员、战绩等从表引用可靠。
  database.pragma('foreign_keys = ON')
  db = database
  return db
}

/** 关闭连接（测试/优雅退出时调用）。幂等，可多次调用。 */
export function closeDb(): void {
  db?.close()
  db = undefined
}

/**
 * 在事务中执行一组操作：begin 后执行 fn，成功 commit，异常 rollback 并向上抛出。
 * better-sqlite3 的事务是同步的，适合本项目的同步领域操作。
 */
export function withTransaction<T>(fn: () => T): T {
  const database = getDb()
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
