import { z } from 'zod'
import { APP_CONFIG } from '../../../../config/index.ts'
import { RequestSchema } from './base.ts'

export const RoomSettingsSchema = z
  .object({
    maxPlayers: z
      .number()
      .int()
      .min(APP_CONFIG.player.minPlayers)
      .max(APP_CONFIG.player.maxPlayers),
    roundsPerPlayer: z
      .number()
      .int()
      .min(APP_CONFIG.game.roundsPerPlayer.min)
      .max(APP_CONFIG.game.roundsPerPlayer.max),
    drawSeconds: z
      .number()
      .int()
      .min(APP_CONFIG.game.drawSeconds.min)
      .max(APP_CONFIG.game.drawSeconds.max),
    chooseSeconds: z
      .number()
      .int()
      .min(APP_CONFIG.game.chooseSeconds.min)
      .max(APP_CONFIG.game.chooseSeconds.max),
    optionCount: z
      .number()
      .int()
      .min(APP_CONFIG.game.optionCount.min)
      .max(APP_CONFIG.game.optionCount.max),
    showWordLength: z.boolean(),
    progressiveHints: z.boolean(),
    structuredHintsEnabled: z.boolean(),
    hintStartRatio: z
      .number()
      .min(APP_CONFIG.game.hintStartRatioRange.min)
      .max(APP_CONFIG.game.hintStartRatioRange.max),
    guessBaseScore: z
      .number()
      .int()
      .min(APP_CONFIG.game.score.guessBaseRange.min)
      .max(APP_CONFIG.game.score.guessBaseRange.max),
    scoreMode: z.enum(['standard', 'flat']),
    allowPlayerInvite: z.boolean(),
    allowPause: z.boolean(),
    allowWordReroll: z.boolean(),
    joinPolicy: z.enum(['forbid', 'spectate', 'next_game']),
  })
  .strict()
export const PrivateRoomCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/gu, '').toUpperCase())
  .refine(
    (value) =>
      value.length === APP_CONFIG.room.privateCodeLength &&
      [...value].every((character) => APP_CONFIG.room.privateCodeAlphabet.includes(character)),
    { message: 'invalid private room code' },
  )
export const CreateRoomSchema = RequestSchema.extend({
  name: z.string().trim().min(1).max(APP_CONFIG.player.roomNameMaxLength),
  visibility: z.enum(['public', 'private']),
  settings: RoomSettingsSchema,
})
export const JoinRoomSchema = RequestSchema.extend({ roomId: z.string().uuid() })
export const JoinPrivateRoomSchema = RequestSchema.extend({ code: PrivateRoomCodeSchema })
export const SetReadySchema = RequestSchema.extend({ ready: z.boolean() })
export const UpdateRoomSettingsSchema = RequestSchema.extend({
  patch: RoomSettingsSchema.partial(),
  expectedVersion: z.number().int().nonnegative(),
})
export const KickMemberSchema = RequestSchema.extend({ targetId: z.string().uuid() })
export const TransferHostSchema = RequestSchema.extend({ targetId: z.string().uuid() })
