import { z } from 'zod'
import { RequestSchema } from './base.ts'
import {
  DEFAULT_GAME_MODE,
  DRAW_SECONDS_OPTIONS,
  GAME_MODES,
  PLAYER_PROTOCOL_LIMITS,
  PRIVATE_ROOM_CODE,
  RELAY_CHOOSE_SECONDS_OPTIONS,
  RELAY_DRAW_SECONDS_OPTIONS,
  RELAY_GUESS_SECONDS_OPTIONS,
  ROOM_RULE_LIMITS,
} from './constants.ts'

export const RoomVisibilitySchema = z.enum(['public', 'private'])

/** 房间玩法：经典（轮流画）或接龙；创建时确定、房间内不可修改（S27 / S28）。 */
export const GameModeSchema = z.enum(GAME_MODES)

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

/** 接龙三时长（选词 / 作画 / 猜词）：与单回合时长同手法，由档位白名单展开字面量联合。 */
export const RelayChooseSecondsSchema = z.union([
  z.literal(RELAY_CHOOSE_SECONDS_OPTIONS[0]),
  z.literal(RELAY_CHOOSE_SECONDS_OPTIONS[1]),
  z.literal(RELAY_CHOOSE_SECONDS_OPTIONS[2]),
  z.literal(RELAY_CHOOSE_SECONDS_OPTIONS[3]),
])
export const RelayDrawSecondsSchema = z.union([
  z.literal(RELAY_DRAW_SECONDS_OPTIONS[0]),
  z.literal(RELAY_DRAW_SECONDS_OPTIONS[1]),
  z.literal(RELAY_DRAW_SECONDS_OPTIONS[2]),
  z.literal(RELAY_DRAW_SECONDS_OPTIONS[3]),
])
export const RelayGuessSecondsSchema = z.union([
  z.literal(RELAY_GUESS_SECONDS_OPTIONS[0]),
  z.literal(RELAY_GUESS_SECONDS_OPTIONS[1]),
  z.literal(RELAY_GUESS_SECONDS_OPTIONS[2]),
  z.literal(RELAY_GUESS_SECONDS_OPTIONS[3]),
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
    /**
     * 接龙三时长（S17 / S39）：仅在接龙模式下生效，档位为白名单。
     * 房主在等待阶段可多次修改（S68）；经典房间保留这些字段但不下发到对局逻辑。
     */
    relayChooseSeconds: RelayChooseSecondsSchema,
    relayDrawSeconds: RelayDrawSecondsSchema,
    relayGuessSeconds: RelayGuessSecondsSchema,
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
  /**
   * 玩法模式与可见性同级（S28）：建房时确定。缺省保持经典模式的现状，
   * 使未升级的选择流程也能建房；接龙房间必须显式声明（S27）。
   */
  gameMode: GameModeSchema.default(DEFAULT_GAME_MODE),
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
