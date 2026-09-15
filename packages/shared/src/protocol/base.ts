import { z } from 'zod'
import { ERROR_CODES, type ErrorCode } from '../error-codes.ts'
import { AVATAR_IDS, PLAYER_PROTOCOL_LIMITS } from './constants.ts'

/** 幂等请求标识：请求与 ack 都必须回显同一 UUID，供客户端核对响应归属。 */
export const RequestIdSchema = z.string().uuid()
export const RequestSchema = z.object({ requestId: RequestIdSchema }).strict()
/**
 * 线上错误码 Schema：只接受 ERROR_CODES 注册表内的码。
 * 未知错误码在客户端属于协议损坏（不是业务失败），必须在运行时被拒绝。
 */
export const ErrorCodeSchema = z.enum(Object.values(ERROR_CODES) as [ErrorCode, ...ErrorCode[]])
export const WordIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9:_-]+$/u, { message: 'invalid word id' })
export const AvatarIdSchema = z.enum(AVATAR_IDS)
export const ProfileSchema = z
  .object({
    nickname: z
      .string()
      .trim()
      .min(PLAYER_PROTOCOL_LIMITS.nicknameMinLength)
      .max(PLAYER_PROTOCOL_LIMITS.nicknameMaxLength * 2),
    avatarId: AvatarIdSchema,
  })
  .strict()
export const RecoveryTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u)
export const RoomPhaseSchema = z.enum([
  'waiting',
  'starting',
  'choosing_word',
  'drawing',
  'round_result',
  'paused',
  'game_result',
  'closed',
])
