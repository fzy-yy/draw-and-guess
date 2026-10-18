/**
 * WebSocket 层统一导出。
 *
 * 事件绑定只有一个实现：`protocol/binder.ts`（校验 + 限频 + 幂等缓存 + 统一 ack），
 * 连接类型别名在 `socket-types.ts`。此目录只保留跨模块网关聚合。
 */
export * from './gateway.ts'
