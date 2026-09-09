/**
 * 前后端共享协议聚合出口。
 * 按职责拆分为 events（事件名）、types（领域类型）、schemas（运行时校验）、pure（纯函数），
 * 全部在 ./index.ts 汇总再导出，保证既有引用路径（@draw-guess/shared）不变。
 */
export * from './events.ts'
export * from './types.ts'
export * from './schemas.ts'
export * from './pure.ts'
export * from './error-codes.ts'
export * from './protocol/constants.ts'
