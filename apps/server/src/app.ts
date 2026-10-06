/**
 * HTTP 与应用组合入口（转发至 server.ts 与 http/app.ts）。
 *
 * 遵循《后端架构规范》R3.2：
 * 组合根已收敛至 server.ts，HTTP 实例装配收敛至 http/app.ts。
 */
export { isAllowedOrigin } from './http/app.ts'
export { isLoopbackAddress } from './http/routes/api.routes.ts'
export {
  createApplication,
  type RunningApplication,
  type CreateApplicationOptions,
} from './server.ts'
