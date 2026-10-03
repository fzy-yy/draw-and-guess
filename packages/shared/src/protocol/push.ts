import { z } from 'zod'
import { EVENTS } from '../events.ts'
import { AvatarIdSchema, JoinPolicySchema, RoomPhaseSchema, WordIdSchema } from './base.ts'
import { PROTOCOL_VERSION, ROOM_CLOSE_CODES } from './constants.ts'
import { FillCommandSchema, StrokeSchema } from './drawing.ts'
import { CanvasPingBroadcastSchema } from './gameplay.ts'
import { RoomSettingsSchema } from './room.ts'

export const ConnectionStateSchema = z.enum(['online', 'reconnecting', 'left'])
export const PresenceStatusSchema = z.enum(['idle', 'in_room', 'playing', 'reconnecting'])
export const PublicPlayerSchema = z
  .object({
    id: z.string().uuid(),
    nickname: z.string(),
    avatarId: AvatarIdSchema,
    status: PresenceStatusSchema,
    roomId: z.string().uuid().optional(),
  })
  .strict()
export const PublicRoomSchema = z
  .object({
    visibility: z.literal('public'),
    id: z.string().uuid(),
    name: z.string(),
    hostName: z.string(),
    playerCount: z.number().int().nonnegative(),
    maxPlayers: z.number().int().positive(),
    phase: RoomPhaseSchema,
    roundsPerPlayer: z.number().int().positive(),
    drawSeconds: z.number().int().positive(),
    joinPolicy: JoinPolicySchema,
  })
  .strict()
export const MemberStatsSchema = z
  .object({
    correctCount: z.number().int().nonnegative(),
    totalGuessMs: z.number().nonnegative(),
    drawingCorrectCount: z.number().int().nonnegative(),
  })
  .strict()
export const RoomMemberSchema = PublicPlayerSchema.extend({
  seatIndex: z.number().int().nonnegative(),
  seatColor: z.string(),
  ready: z.boolean(),
  score: z.number(),
  isHost: z.boolean(),
  isDrawer: z.boolean(),
  guessed: z.boolean(),
  spectating: z.boolean(),
  waitingForNextGame: z.boolean(),
  rematchReady: z.boolean(),
  leftGame: z.boolean(),
  connection: ConnectionStateSchema,
  stats: MemberStatsSchema,
}).strict()
export const ChatMessageSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(['guess', 'system', 'correct', 'preset', 'near_miss']),
    text: z.string(),
    playerId: z.string().uuid().optional(),
    createdAt: z.number(),
  })
  .strict()
export const ScoreDetailSchema = z
  .object({
    playerId: z.string().uuid(),
    /** 本回合猜中顺序（1 起）。 */
    order: z.number().int().positive(),
    /** 本回合得分：只由猜中顺序决定（100/80/60/40/20）。 */
    total: z.number(),
  })
  .strict()
export const RoundResultSchema = z
  .object({ answer: z.string(), details: z.array(ScoreDetailSchema), drawerScore: z.number() })
  .strict()
export const FinalRankingEntrySchema = z
  .object({
    id: z.string().uuid(),
    nickname: z.string(),
    avatarId: AvatarIdSchema,
    rank: z.number().int().positive(),
    score: z.number(),
    stats: MemberStatsSchema,
  })
  .strict()
export const DrawingCommandSchema = z.discriminatedUnion('kind', [
  StrokeSchema.strict(),
  FillCommandSchema.strict(),
])
export const GameViewSchema = z
  .object({
    gameId: z.string().uuid(),
    roundId: z.union([z.string().uuid(), z.literal('')]),
    phaseBeforePause: RoomPhaseSchema.optional(),
    currentRound: z.number().int().nonnegative(),
    totalRounds: z.number().int().nonnegative(),
    drawerId: z.union([z.string().uuid(), z.literal('')]),
    phaseStartedAt: z.number(),
    phaseEndsAt: z.number(),
    pausedRemainingMs: z.number().nonnegative().optional(),
    answerMask: z.string(),
    answer: z.string().optional(),
    wordOptions: z
      .array(
        z
          .object({
            id: WordIdSchema,
            text: z.string(),
          })
          .strict(),
      )
      .optional(),
    canReroll: z.boolean().optional(),
    strokes: z.array(DrawingCommandSchema),
    strokesOmitted: z.boolean().optional(),
    undoneStrokeIds: z.array(z.string()),
    lastSequence: z.number().int(),
    drawingRevision: z.number().int().nonnegative(),
    messages: z.array(ChatMessageSchema),
    roundResult: RoundResultSchema.optional(),
    finalRanking: z.array(FinalRankingEntrySchema).optional(),
    gameResultMinEndsAt: z.number().optional(),
    canReturnWaiting: z.boolean().optional(),
  })
  .strict()

export const RoomSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    hostId: z.string().uuid(),
    visibility: z.enum(['public', 'private']),
    privateJoinCode: z.string().optional(),
    phase: RoomPhaseSchema,
    stateVersion: z.number().int().nonnegative(),
    settings: RoomSettingsSchema,
    members: z.array(RoomMemberSchema),
    selectedWordCount: z.number().int().nonnegative(),
    totalWordCount: z.number().int().nonnegative(),
    vocabularyPackageId: z.string().optional(),
    vocabularyPackageName: z.string().optional(),
    game: GameViewSchema.optional(),
  })
  .strict()
export const PresenceSnapshotSchema = z
  .object({ players: z.array(PublicPlayerSchema), rooms: z.array(PublicRoomSchema) })
  .strict()
export const InviteSchema = z
  .object({
    id: z.string().uuid(),
    roomId: z.string().uuid(),
    roomName: z.string(),
    from: PublicPlayerSchema,
    expiresAt: z.number(),
  })
  .strict()
export const MemberConnectionChangeSchema = z
  .object({ playerId: z.string().uuid(), nickname: z.string(), connection: ConnectionStateSchema })
  .strict()
export const RoomCloseCodeSchema = z.enum(ROOM_CLOSE_CODES)

function pushEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), data }).strict()
}

export const SERVER_PUSH_SCHEMAS = {
  [EVENTS.presenceSnapshot]: pushEnvelope(PresenceSnapshotSchema),
  [EVENTS.roomListChanged]: pushEnvelope(z.array(PublicRoomSchema)),
  [EVENTS.roomSnapshot]: pushEnvelope(RoomSnapshotSchema),
  [EVENTS.roomMemberConnectionChanged]: pushEnvelope(MemberConnectionChangeSchema),
  [EVENTS.inviteReceived]: pushEnvelope(InviteSchema),
  [EVENTS.inviteResolved]: pushEnvelope(
    z.object({ id: z.string().uuid(), status: z.string() }).strict(),
  ),
  [EVENTS.roomClosed]: pushEnvelope(
    z.object({ reason: z.string(), code: RoomCloseCodeSchema }).strict(),
  ),
  [EVENTS.systemNotice]: pushEnvelope(z.object({ text: z.string() }).strict()),
  [EVENTS.systemError]: pushEnvelope(z.object({ text: z.string() }).strict()),
  [EVENTS.drawStrokeBatch]: pushEnvelope(
    z
      .object({
        roomId: z.string().uuid(),
        gameId: z.string().uuid(),
        roundId: z.string().uuid(),
        drawingRevision: z.number().int().positive(),
        stroke: StrokeSchema.strict(),
      })
      .strict(),
  ),
  [EVENTS.drawFillCommit]: pushEnvelope(
    z
      .object({
        roomId: z.string().uuid(),
        gameId: z.string().uuid(),
        roundId: z.string().uuid(),
        drawingRevision: z.number().int().positive(),
        fill: FillCommandSchema.strict(),
      })
      .strict(),
  ),
  [EVENTS.gameCanvasPing]: pushEnvelope(CanvasPingBroadcastSchema),
} as const

export type ServerPushEventName = keyof typeof SERVER_PUSH_SCHEMAS

/**
 * 推送事件的运行时清单：`SERVER_PUSH_SCHEMAS` 的键（唯一事实源同时派生类型与清单）。
 * `Object.keys` 只能返回 string[]，对字面量映射的同态派生不可证，断言放在事实源旁边；
 * 客户端 attach/dispose 直接迭代本清单（ADR-0020），不再各自维护注册/解绑列表。
 */
export const SERVER_PUSH_EVENT_NAMES: readonly ServerPushEventName[] = Object.keys(
  SERVER_PUSH_SCHEMAS,
) as ServerPushEventName[]

export type ServerPushEnvelope<E extends ServerPushEventName = ServerPushEventName> = z.infer<
  (typeof SERVER_PUSH_SCHEMAS)[E]
>
export type ServerPushData<E extends ServerPushEventName> = ServerPushEnvelope<E>['data']
export type ServerToClientEvents = {
  [E in ServerPushEventName]: (payload: ServerPushEnvelope<E>) => void
}

/**
 * 包装服务端推送数据为版本化信封（protocolVersion + data）。
 *
 * 事件名参数只参与类型推导、不进信封内容：它把 payload 与该事件 Schema 推导出的
 * data 类型在**编译期**绑定，事件与载荷配错（含拼错事件名）直接编译失败，
 * 不再只靠 `SERVER_PUSH_SCHEMAS` 的运行时解码兜底。
 * 参数名带 `_` 前缀：运行时不读取（ESLint no-unused-vars 约定）。
 */
export function createServerPush<E extends ServerPushEventName>(
  _event: E,
  data: ServerPushData<E>,
): ServerPushEnvelope<E> {
  // 泛型体内 z.infer<(typeof SERVER_PUSH_SCHEMAS)[E]> 是延迟索引类型，E 以约束（联合）
  // 实例化时 data 的联合无法落入某个具体信封；调用点已按具体事件名校验 data，返回处适配一次。
  return { protocolVersion: PROTOCOL_VERSION, data } as ServerPushEnvelope<E>
}
