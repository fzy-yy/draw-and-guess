/**
 * 前后端共享协议聚合出口。
 * 按职责拆分为 events（事件名契约）、types/（领域类型）、protocol/（运行时 Schema 权威）、pure（纯函数），
 * 全部在本文件汇总再导出，保证既有引用路径（@draw-guess/shared）不变。
 */
export * from './events.ts'
export * from './types/index.ts'
export * from './protocol/index.ts'
export * from './pure.ts'
export * from './error-codes.ts'
export * from './protocol/constants.ts'
