import { z } from 'zod'
import { EVENTS } from '../events.ts'
import { AvatarIdSchema, RoomPhaseSchema, WordIdSchema } from './base.ts'
import { PROTOCOL_VERSION } from './constants.ts'
import { FillCommandSchema, StrokeSchema } from './drawing.ts'
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
    joinPolicy: z.enum(['forbid', 'spectate', 'next_game']),
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
  leftGame: z.boolean(),
  connection: ConnectionStateSchema,
  stats: MemberStatsSchema,
}).strict()
export const ChatMessageSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(['guess', 'system', 'correct', 'preset']),
    text: z.string(),
    playerId: z.string().uuid().optional(),
    createdAt: z.number(),
  })
  .strict()
export const ScoreDetailSchema = z
  .object({
    playerId: z.string().uuid(),
    base: z.number(),
    speed: z.number(),
    order: z.number(),
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
    wordCategory: z.string().optional(),
    wordOptions: z
      .array(
        z.object({ id: WordIdSchema, text: z.string(), difficulty: z.number().int() }).strict(),
      )
      .optional(),
    canReroll: z.boolean().optional(),
    revealedHints: z.array(z.string()).optional(),
    strokes: z.array(DrawingCommandSchema),
    strokesOmitted: z.boolean().optional(),
    undoneStrokeIds: z.array(z.string()),
    lastSequence: z.number().int(),
    drawingRevision: z.number().int().nonnegative(),
    messages: z.array(ChatMessageSchema),
    roundResult: RoundResultSchema.optional(),
    finalRanking: z.array(FinalRankingEntrySchema).optional(),
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
  [EVENTS.roomClosed]: pushEnvelope(z.object({ reason: z.string() }).strict()),
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
} as const

export type ServerPushEventName = keyof typeof SERVER_PUSH_SCHEMAS

export type ServerPushEnvelope<E extends ServerPushEventName = ServerPushEventName> = z.infer<
  (typeof SERVER_PUSH_SCHEMAS)[E]
>
export type ServerPushData<E extends ServerPushEventName> = ServerPushEnvelope<E>['data']
export type ServerToClientEvents = {
  [E in ServerPushEventName]: (payload: ServerPushEnvelope<E>) => void
}

export function createServerPush<T>(data: T): {
  protocolVersion: typeof PROTOCOL_VERSION
  data: T
} {
  return { protocolVersion: PROTOCOL_VERSION, data }
}
