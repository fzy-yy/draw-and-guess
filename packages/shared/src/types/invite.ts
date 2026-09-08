import type { z } from 'zod'
import type { InviteSchema } from '../protocol/push.ts'

export type Invite = z.infer<typeof InviteSchema>
