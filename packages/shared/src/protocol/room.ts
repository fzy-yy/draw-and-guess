import { z } from 'zod'
import { RequestSchema } from './base.ts'
import {
  DRAW_SECONDS_OPTIONS,
  PLAYER_PROTOCOL_LIMITS,
  PRIVATE_ROOM_CODE,
  ROOM_RULE_LIMITS,
} from './constants.ts'

export const RoomVisibilitySchema = z.enum(['public', 'private'])

/**
 * 单回合时长：字面量联合直接由 DRAW_SECONDS_OPTIONS 展开，
 * 保证「合法档位」在协议与配置之间只有一份来源（105/135 这类旧值会被拒）。
 */
export const DrawSecondsSchema = z.union([
  z.literal(DRAW_SECONDS_OPTIONS[0]),
  z.literal(DRAW_SECONDS_OPTIONS[1]),
  z.literal(DRAW_SECONDS_OPTIONS[2]),
  z.literal(DRAW_SECONDS_OPTIONS[3]),
])

export const RoomSettingsSchema = z
  .object({
    roundsPerPlayer: z
      .number()
      .int()
      .min(ROOM_RULE_LIMITS.roundsPerPlayer.min)
      .max(ROOM_RULE_LIMITS.roundsPerPlayer.max),
    drawSeconds: DrawSecondsSchema,
    chooseSeconds: z
      .number()
      .int()
      .min(ROOM_RULE_LIMITS.chooseSeconds.min)
      .max(ROOM_RULE_LIMITS.chooseSeconds.max),
    /**
     * 选词阶段是否计时。关闭时服务端不写截止时间（phaseEndsAt = 0）、不排超时计时器，
     * 画家可以一直想；只有画家离开/掉线才由兜底路径代选
     * （见 docs/adr/0045-custom-word-and-untimed-choosing.md）。
     */
    allowChooseTimeLimit: z.boolean(),
    optionCount: z
      .number()
      .int()
      .min(ROOM_RULE_LIMITS.optionCount.min)
      .max(ROOM_RULE_LIMITS.optionCount.max),
    showWordLength: z.boolean(),
    progressiveHints: z.boolean(),
    allowPlayerInvite: z.boolean(),
    allowPause: z.boolean(),
    allowWordReroll: z.boolean(),
    /** 是否允许画家在选词阶段自定义题目（默认关闭，见 ADR-0045）。 */
    allowCustomWord: z.boolean(),
    /** 猜词差一字时是否向猜词者单人私密提示（默认开启）。 */
    allowNearMissHint: z.boolean().default(true),
    /** 是否允许猜词者在画布上发送轻量微表情气泡互动（默认开启）。 */
    allowCanvasReactions: z.boolean().default(true),
    /** 回合结束时是否在画布上快速重播画家作画全过程（默认开启）。 */
    allowRoundReplay: z.boolean().default(true),
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
