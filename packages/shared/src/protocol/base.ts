import { z } from 'zod'
import { APP_CONFIG } from '../../../../config/index.ts'

export const RequestSchema = z.object({ requestId: z.string().uuid() }).strict()
export const WordIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9:_-]+$/u, { message: 'invalid word id' })
export const AvatarIdSchema = z.enum(APP_CONFIG.player.avatarIds)
export const ProfileSchema = z
  .object({
    nickname: z
      .string()
      .trim()
      .min(1)
      .max(APP_CONFIG.player.nicknameMaxLength * 2),
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
