import { z } from 'zod'
import { ProfileSchema, RecoveryTokenSchema, RequestSchema } from './base.ts'

export const RegisterSchema = RequestSchema.extend({
  protocolVersion: z.string().min(1).max(16),
  profile: ProfileSchema,
  recoveryToken: RecoveryTokenSchema.optional(),
  preferences: z.object({ discoverable: z.boolean(), acceptsInvites: z.boolean() }).strict(),
})
export const LogoutSchema = RequestSchema
export const StateResyncSchema = RequestSchema.extend({
  roomId: z.string().uuid().optional(),
  gameId: z.string().uuid().optional(),
  roundId: z.string().uuid().optional(),
})
