/**
 * SQLite 实例上下文（转发至 infra/sqlite/connection.ts 统一实现）。
 *
 * 遵循《后端架构规范》R4.5b：
 * 采用严格 PRAGMA 顺序、StatementCache 预编译语句缓存与 BEGIN IMMEDIATE 事务。
 */
export * from '../infra/sqlite/connection.ts'
