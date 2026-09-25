import { z } from 'zod'
import { RequestSchema } from './base.ts'
import { PLAYER_PROTOCOL_LIMITS, PRIVATE_ROOM_CODE, ROOM_RULE_LIMITS } from './constants.ts'

export const RoomVisibilitySchema = z.enum(['public', 'private'])

export const RoomSettingsSchema = z
  .object({
    maxPlayers: z
      .number()
      .int()
      .min(PLAYER_PROTOCOL_LIMITS.minPlayers)
      .max(PLAYER_PROTOCOL_LIMITS.maxPlayers),
    roundsPerPlayer: z
      .number()
      .int()
      .min(ROOM_RULE_LIMITS.roundsPerPlayer.min)
      .max(ROOM_RULE_LIMITS.roundsPerPlayer.max),
    drawSeconds: z
      .number()
      .int()
      .min(ROOM_RULE_LIMITS.drawSeconds.min)
      .max(ROOM_RULE_LIMITS.drawSeconds.max),
    chooseSeconds: z
      .number()
      .int()
      .min(ROOM_RULE_LIMITS.chooseSeconds.min)
      .max(ROOM_RULE_LIMITS.chooseSeconds.max),
    optionCount: z
      .number()
      .int()
      .min(ROOM_RULE_LIMITS.optionCount.min)
      .max(ROOM_RULE_LIMITS.optionCount.max),
    showWordLength: z.boolean(),
    progressiveHints: z.boolean(),
    structuredHintsEnabled: z.boolean(),
    hintStartRatio: z
      .number()
      .min(ROOM_RULE_LIMITS.hintStartRatio.min)
      .max(ROOM_RULE_LIMITS.hintStartRatio.max),
    guessBaseScore: z
      .number()
      .int()
      .min(ROOM_RULE_LIMITS.guessBaseScore.min)
      .max(ROOM_RULE_LIMITS.guessBaseScore.max),
    // 额外猜词时间：叠加在难度派生时限之上的秒数（0~90），计分方式已固定为标准不再可配。
    extraGuessSeconds: z
      .number()
      .int()
      .min(ROOM_RULE_LIMITS.extraGuessSeconds.min)
      .max(ROOM_RULE_LIMITS.extraGuessSeconds.max),
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
      value.length === PRIVATE_ROOM_CODE.length &&
      [...value].every((character) => PRIVATE_ROOM_CODE.alphabet.includes(character)),
    { message: 'invalid private room code' },
  )
export const CreateRoomSchema = RequestSchema.extend({
  name: z.string().trim().min(1).max(PLAYER_PROTOCOL_LIMITS.roomNameMaxLength),
  visibility: RoomVisibilitySchema,
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
