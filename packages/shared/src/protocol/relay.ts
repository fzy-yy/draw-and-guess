/**
 * 接龙模式的线上请求契约（S30 / S48 / S51 / S53 / S79）。
 *
 * 接龙不复用经典 `draw:*` 与 `guess:submit`：字段与目标解析都不同——
 * - 绘图用**每步一个全局步骤 id**（`stepId`，该步所有玩家共用）定位目标画布，
 *   服务端按 `(playerId, stepId)` 解析该玩家本步负责的链画布（S53）；
 * - 提交拆成两条：猜词带文本（1～`chatMaxLength` 字，禁止空提交，S15）、作画只标记完成；
 * - 聊天是独立事件（`chat:say`），与作答彻底分离（S79 / S20），且**只服务接龙**（S85）。
 *
 * 本文件只放请求载荷；接龙视图（下行）在 `protocol/push.ts`。
 */
import { z } from 'zod'
import { RequestSchema } from './base.ts'
import { PLAYER_PROTOCOL_LIMITS } from './constants.ts'

/**
 * 接龙阶段：`RoomPhaseSchema` 的接龙子集。
 * `paused` 不在其中——接龙禁用暂停（S19）；复盘只有 `relay_showcase`（轮播）与 `relay_vote`（投票）两态。
 */
export const RelayPhaseSchema = z.enum([
  'relay_choose',
  'relay_draw',
  'relay_guess',
  'relay_showcase',
  'relay_vote',
])

/**
 * 步骤号：一条链固定 `RELAY_STEP_COUNT`（=4）步（S9），步 1/3 作画、步 2/4 猜词。
 * 显式列字面量使「非法的第 5 步」在协议边界即被拒绝；
 * 步数常量与这里的上界由 `protocol-schema-pairing` 用例钉死为同一口径。
 */
export const RelayStepSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])

/** 半场：一条链的复盘分两段（第 1 幅画 → 第 2 幅画），每段「重播 → 停顿 → 揭晓」（S43）。 */
export const RelayHalfSchema = z.union([z.literal(1), z.literal(2)])

/**
 * 每步的全局步骤 id：服务端按观看者 + 步骤 id 解析其本步负责的链画布。
 * 复用 uuid 形状（与经典 roundId 同构），但语义是「一步」而不是「一回合」。
 */
export const RelayStepIdSchema = z.string().uuid()

/** 接龙绘图事件族共用载荷：只有步骤 id，目标画布由服务端按观看者解析（S51 / S53）。 */
export const RelayDrawingRoundSchema = RequestSchema.extend({ stepId: RelayStepIdSchema })

/**
 * 提交猜词：只记录文本，不判对错、不计分、不进聊天流（S3 / S20）。
 * 文本上限沿用 `chatMaxLength`（S15 的输入口与聊天同口径）。
 */
export const SubmitGuessSchema = RequestSchema.extend({
  stepId: RelayStepIdSchema,
  text: z.string().min(1).max(PLAYER_PROTOCOL_LIMITS.chatMaxLength),
})

/** 提交作画：仅标记本步完成并锁定（交已有笔画，S30）。 */
export const SubmitDrawingSchema = RequestSchema.extend({ stepId: RelayStepIdSchema })

/** 接龙聊天：自由社交频道，不含步骤 id，永远不会把作答带出去（S79 / S20）。 */
export const SendChatSchema = RequestSchema.extend({
  text: z.string().min(1).max(PLAYER_PROTOCOL_LIMITS.chatMaxLength),
})
