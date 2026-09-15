import type { z } from 'zod'
import type { SessionRegistrationSchema } from '../protocol/response.ts'

/** 注册 ack 的成功数据由响应 Schema 推导，避免手写类型与线格式漂移。 */
export type SessionRegistration = z.infer<typeof SessionRegistrationSchema>
