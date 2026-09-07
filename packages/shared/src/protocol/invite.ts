import { z } from 'zod'
import { RequestSchema } from './base.ts'

export const SendInviteSchema = RequestSchema.extend({ targetId: z.string().uuid() })
export const RespondInviteSchema = RequestSchema.extend({
  inviteId: z.string().uuid(),
  accept: z.boolean(),
})
