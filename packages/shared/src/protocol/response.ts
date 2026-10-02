/**
 * 客户端请求 → 服务端 ack 的完整运行时边界（与 `CLIENT_REQUEST_SCHEMAS`、`SERVER_PUSH_SCHEMAS` 对称）。
 *
 * `CLIENT_RESPONSE_SCHEMAS` 为每个请求事件提供一份完整 ack Schema：
 * - 成功分支要求 `ok: true` + 通过事件级 data Schema。无返回数据的事件使用共享的
 *   `z.void().optional()`（JSON 线传输会丢掉 `undefined`，这是既有线格式，不允许改动）；
 *   `RoomSnapshot | undefined` 事件使用可选 Schema——缺 data 的成功只在这些事件上合法；
 * - 失败分支要求 `ok: false` + 已登记的错误码 + 非空安全文案 + 回显的 `requestId`；
 * - 外壳与错误对象均为 strict：未知字段直接判为协议损坏。
 *
 * 客户端在 `createRequester` 中对每次 `emitWithAck` 结果做 safeParse，响应 data / ack 类型
 * 全部从这里推导（`ClientResponseData` / `ClientResponseAck`），避免手写接口与线格式漂移。
 * 空响应与“可能没有房间”的成功外壳在所有相关事件间共享同一 Schema 实例，控制入口体积
 * （设计与取舍见 docs/adr/0012-ack-runtime-boundary.md）。
 */
import { z } from 'zod'
import { EVENTS } from '../events.ts'
import { ErrorCodeSchema, RecoveryTokenSchema, RequestIdSchema, WordIdSchema } from './base.ts'
import {
  InviteSchema,
  PresenceSnapshotSchema,
  PublicPlayerSchema,
  PublicRoomSchema,
  RoomSnapshotSchema,
} from './push.ts'

/** 注册响应：身份、轮换后的恢复令牌与恢复出的房间（`null` 表示不在房间）。 */
export const SessionRegistrationSchema = z
  .object({
    player: PublicPlayerSchema,
    recoveryToken: RecoveryTokenSchema,
    restored: z.boolean(),
    room: RoomSnapshotSchema.nullable(),
  })
  .strict()

/**
 * 单个词条：仅描述公开字段，来自词库 Provider 的规范化输出。
 * 难度、可绘制性、提示与「按难度派生的时限/权重」已随词库瘦身移除
 *（见 docs/adr/0046-vocabulary-slimming-and-unified-round-time.md）；
 * 词条只剩词面、合集、别称与稳定 ID（见 docs/adr/0053）。
 */
export const VocabularyWordSchema = z
  .object({
    id: WordIdSchema,
    text: z.string().min(1),
    aliases: z.array(z.string()),
    collection: z.string().min(1),
  })
  .strict()

/** 词库包元信息（用于客户端切换词库包）。 */
export const VocabularyPackageInfoSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    wordCount: z.number().int().nonnegative(),
    description: z.string(),
    version: z.string(),
    updatedAt: z.string(),
  })
  .strict()

/** 房间词库快照：当前包、全部可用包、词条列表、已选词条、版本与自动检测聚合的合集列表。 */
export const VocabularySnapshotSchema = z
  .object({
    packageId: z.string(),
    packages: z.array(VocabularyPackageInfoSchema),
    items: z.array(VocabularyWordSchema),
    selectedIds: z.array(WordIdSchema),
    version: z.string(),
    collections: z.array(z.string()),
  })
  .strict()

/** 笔画批次 ack：服务端确认的修订号与剩余预算，用于本地追平与容量提示。 */
export const StrokeAckSchema = z
  .object({
    strokeId: z.string().min(4).max(64),
    pointCount: z.number().int().nonnegative(),
    drawingRevision: z.number().int().positive(),
    remainingBudget: z.number().nonnegative(),
  })
  .strict()

/** 失败分支对所有请求事件形状一致；错误码必须来自注册表。 */
export const CLIENT_ACK_FAILURE_SCHEMA = z
  .object({
    ok: z.literal(false),
    error: z.object({ code: ErrorCodeSchema, message: z.string().min(1) }).strict(),
    requestId: RequestIdSchema,
  })
  .strict()

/**
 * 构造某事件的完整 ack Schema（成功外壳 | 共享失败外壳）。
 * data Schema 自身携带“必填/可缺省”语义，因此不在这里额外放宽。
 */
function eventAckSchema<T extends z.ZodType>(data: T) {
  const successAckSchema = z
    .object({ ok: z.literal(true), data, requestId: RequestIdSchema })
    .strict()
  return z.union([successAckSchema, CLIENT_ACK_FAILURE_SCHEMA])
}

/** 空响应（void）与“可能没有房间”两种成功外壳在同类事件间共享，控制模块初始化体积。 */
const emptyAckSchema = eventAckSchema(z.void().optional())
const optionalRoomSnapshotAckSchema = eventAckSchema(RoomSnapshotSchema.optional())
const logoutDataSchema = z.object({ success: z.literal(true) }).strict()
const guessResultSchema = z.object({ correct: z.boolean() }).strict()
const drawingRevisionSchema = z.object({ drawingRevision: z.number().int().positive() }).strict()
const pingResultSchema = z.object({ clientTime: z.number(), serverTime: z.number() }).strict()

/**
 * 客户端请求事件到完整 ack Schema 的唯一映射。
 * 新增请求事件时必须同时登记请求 Schema、响应 Schema 与领域处理器，缺一即被守卫测试拦下。
 */
export const CLIENT_RESPONSE_SCHEMAS = {
  [EVENTS.sessionRegister]: eventAckSchema(SessionRegistrationSchema),
  [EVENTS.sessionLogout]: eventAckSchema(logoutDataSchema),
  [EVENTS.sessionUpdateProfile]: eventAckSchema(PublicPlayerSchema),
  [EVENTS.presenceGet]: eventAckSchema(PresenceSnapshotSchema),
  [EVENTS.presenceUpdatePreferences]: emptyAckSchema,
  [EVENTS.roomList]: eventAckSchema(z.array(PublicRoomSchema)),
  [EVENTS.roomCreate]: eventAckSchema(RoomSnapshotSchema),
  [EVENTS.roomJoin]: eventAckSchema(RoomSnapshotSchema),
  [EVENTS.roomJoinPrivate]: eventAckSchema(RoomSnapshotSchema),
  [EVENTS.roomLeave]: emptyAckSchema,
  [EVENTS.roomUpdateSettings]: eventAckSchema(RoomSnapshotSchema),
  [EVENTS.roomGetVocabulary]: eventAckSchema(VocabularySnapshotSchema),
  [EVENTS.roomUpdateVocabulary]: eventAckSchema(VocabularySnapshotSchema),
  [EVENTS.roomSelectVocabularyPackage]: eventAckSchema(VocabularySnapshotSchema),
  [EVENTS.roomSetReady]: eventAckSchema(RoomSnapshotSchema),
  [EVENTS.roomKick]: emptyAckSchema,
  [EVENTS.roomTransferHost]: emptyAckSchema,
  [EVENTS.inviteSend]: eventAckSchema(InviteSchema),
  [EVENTS.inviteRespond]: optionalRoomSnapshotAckSchema,
  [EVENTS.gameStart]: eventAckSchema(RoomSnapshotSchema),
  [EVENTS.gameChooseWord]: emptyAckSchema,
  [EVENTS.gameRerollWords]: emptyAckSchema,
  [EVENTS.gameCustomWord]: emptyAckSchema,
  [EVENTS.gamePauseRequest]: emptyAckSchema,
  [EVENTS.gameResume]: emptyAckSchema,
  [EVENTS.gameEndEarly]: emptyAckSchema,
  [EVENTS.gameLeave]: emptyAckSchema,
  [EVENTS.gameReturnWaiting]: emptyAckSchema,
  [EVENTS.guessSubmit]: eventAckSchema(guessResultSchema),
  [EVENTS.chatPreset]: emptyAckSchema,
  [EVENTS.drawStrokeBatch]: eventAckSchema(StrokeAckSchema),
  [EVENTS.drawFillCommit]: eventAckSchema(drawingRevisionSchema),
  [EVENTS.drawUndo]: emptyAckSchema,
  [EVENTS.drawRedo]: emptyAckSchema,
  [EVENTS.drawClear]: emptyAckSchema,
  [EVENTS.stateResync]: optionalRoomSnapshotAckSchema,
  [EVENTS.networkPing]: eventAckSchema(pingResultSchema),
} as const

export type ClientResponseEvent = keyof typeof CLIENT_RESPONSE_SCHEMAS

/** 某事件的完整 ack 联合类型（成功 | 失败），由运行时 Schema 推导。 */
export type ClientResponseAck<E extends ClientResponseEvent> = z.infer<
  (typeof CLIENT_RESPONSE_SCHEMAS)[E]
>

/** 某事件成功分支的 data 类型；void 事件为 `void | undefined`（合法响应允许缺省 data）。 */
export type ClientResponseData<E extends ClientResponseEvent> = Extract<
  ClientResponseAck<E>,
  { ok: true }
>['data']
