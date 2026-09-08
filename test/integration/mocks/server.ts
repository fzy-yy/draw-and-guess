import { setupServer } from 'msw/node'

/**
 * 集成测试统一网络边界。当前客户端业务通信以 Socket.IO 为主，HTTP 尚无数据请求；
 * 空 handler 集合配合 onUnhandledRequest=error，可确保新增请求不会意外访问真实服务。
 */
export const server = setupServer()
