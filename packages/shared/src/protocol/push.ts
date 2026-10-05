import { z } from 'zod'
import { EVENTS } from '../events.ts'
import { AvatarIdSchema, RoomPhaseSchema, WordIdSchema } from './base.ts'
import { PROTOCOL_VERSION, ROOM_CLOSE_CODES } from './constants.ts'
import { FillCommandSchema, StrokeSchema } from './drawing.ts'
import { CanvasPingBroadcastSchema } from './gameplay.ts'
import {
  RelayHalfSchema,
  RelayPhaseSchema,
  RelayStepIdSchema,
  RelayStepSchema,
  RelayVoteChoiceSchema,
} from './relay.ts'
import { GameModeSchema, RoomSettingsSchema } from './room.ts'

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
    /** 大厅行的模式徽标（S47 / S80）：容量固定为协议常量，不再下发人数上限（S61 / S67）。 */
    gameMode: GameModeSchema,
    phase: RoomPhaseSchema,
    roundsPerPlayer: z.number().int().positive(),
    drawSeconds: z.number().int().positive(),
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

/**
 * 接龙玩家极小资料：复盘与对局期的 chip（头像 + 昵称）。
 * 画笔角标不在这里下发——它由「这一段里谁动笔画了」按位置派生（S73 / §8.1）。
 */
export const RelayPlayerRefSchema = z
  .object({
    id: z.string().uuid(),
    nickname: z.string(),
    avatarId: AvatarIdSchema,
  })
  .strict()

/**
 * 接龙画布产物：作画棒 = 自己的画布（可绘制），猜词棒 = 上家画作（只读）。
 * 与经典 GameView 的绘图字段同形（命令历史 + 撤销栈 + 序号 + 修订），客户端复用同一重放机器。
 */
export const RelayCanvasSchema = z
  .object({
    strokes: z.array(DrawingCommandSchema),
    undoneStrokeIds: z.array(z.string()),
    lastSequence: z.number().int(),
    drawingRevision: z.number().int().nonnegative(),
  })
  .strict()

/**
 * 复盘/投票期的一个胶囊：chip（玩家）+ 答案 UI（文本）。
 * `text` 为 `null` 表示**未揭晓**——服务端既不下发未揭晓的答案，也不下发它的长度（S81），
 * 客户端用固定宽度的经典下划线占位。
 */
export const RelayShowcaseCapsuleSchema = z
  .object({
    player: RelayPlayerRefSchema,
    text: z.string().nullable(),
  })
  .strict()

/**
 * 接龙终局榜的一行（S33 / S77）：**只有名次、分数与接龙口径统计**——
 * 没有称号、没有「最佳默契链条」卡片，也没有任何链明细（链画作 / 投票 / 归属都不下发）。
 * 排序规则与经典结算同口径：分数降序、同分并列同名次、同分按入房先后；
 * `chainCount` 为该玩家参与过的链数（每条链 4 棒，N 人局每人固定 4 条链，S9 / S24），
 * `agreeVotes` 为这些链累计收到的赞同票数（口径与入账分数同源，S13 / S24 不做归一化）。
 */
export const RelayFinalRankingEntrySchema = z
  .object({
    id: z.string().uuid(),
    nickname: z.string(),
    avatarId: AvatarIdSchema,
    rank: z.number().int().positive(),
    score: z.number(),
    chainCount: z.number().int().nonnegative(),
    agreeVotes: z.number().int().nonnegative(),
  })
  .strict()

/**
 * 接龙视图所处的房间阶段：五个接龙阶段 + `game_result`（终局）。
 * 终局仍要在接龙视图里下发排名与统计（S33 / S77），因此这里是**接龙视图专属**的放宽，
 * 经典 `GameView` 与 `RelayPhaseSchema` 本身都不动。
 */
export const RelayViewPhaseSchema = z.union([RelayPhaseSchema, z.literal('game_result')])

/** 复盘期视图：第 k / N 条链的第几个半场、双胶囊内容、本半场画作与匿名票行（S63）。 */
export const RelayShowcaseSchema = z
  .object({
    /** 第几条链（1 起，按链发起人席位顺序轮播，S11）。 */
    chainIndex: z.number().int().positive(),
    /** 本局链总数（= 开局人数）。 */
    chainCount: z.number().int().positive(),
    half: RelayHalfSchema,
    /**
     * 左胶囊：画家 chip + 题面。
     * 展示期＝本半场的题面（半场 1 为第 1 棒初始词、半场 2 为第 2 棒猜词）；
     * **投票期＝该链的初始词与其作者**——投票判定的是「初始词与最终答案是否匹配」（S13 / US44）。
     */
    prompt: RelayShowcaseCapsuleSchema,
    /** 右胶囊：猜词者 chip + 答案（未揭晓时 text 为 null）。 */
    answer: RelayShowcaseCapsuleSchema,
    /** 本半场重播的画作（该链两幅画之一，全量下发由客户端只读重放，S32）。 */
    drawing: RelayCanvasSchema,
    /**
     * 匿名票行：只有赞同 / 不赞同两项、按**到达顺序**实时插入（S42），仅投票期出现。
     * 单元里没有投票者身份，也不表达「谁投了哪一票」；倒计时结束后未投者按不赞同补在行尾（S14）。
     */
    votes: z.array(RelayVoteChoiceSchema).optional(),
  })
  .strict()

/**
 * 接龙快照视图：**strict + 按观看者的最小集**（S63）。
 * 只承载「观看者当前这一步所需」的内容，绝不包含其余链的任何内容、未揭晓的答案（含其长度）
 * 与候选词池——其余链的秘密只存在于服务端（S35）。字段与步骤的对应关系由服务端视图构建器实现：
 * - `relay_choose`（步 1）：`wordOptions` + `canReroll`（只有自己的候选）；
 * - `relay_draw`（步 1/3）：`ownCanvas` + `prompt`（步 1 自己的词 / 步 3 上家文本），步 3 另带 `previousArtist`；
 * - `relay_guess`（步 2/4）：`previousDrawing`（只读）+ `previousArtist`；
 * - `relay_showcase` / `relay_vote`：`showcase`（链进度 + 半场 + 双胶囊 + 票行）；
 * - `game_result`（终局）：`finalRanking` + 结算退出时限（其余内容一律不下发）。
 * `messages` 是房间级自由聊天流，与作答彻底分离（S79 / S20），不含任何作答内容。
 */
export const RelayGameViewSchema = z
  .object({
    /** 当前接龙阶段（与房间 `phase` 同源）；终局为 `game_result`（S33 的排名要在本视图里下发）。 */
    phase: RelayViewPhaseSchema,
    /** 当前步骤号（1～4）。 */
    currentStep: RelayStepSchema,
    /** 当前步骤 id（该步所有玩家共用；客户端门禁按它比较，S60）。 */
    stepId: RelayStepIdSchema,
    phaseStartedAt: z.number(),
    phaseEndsAt: z.number(),
    /** 我是否已提交本步（作画/猜词）或已投票（投票期）；左侧面板状态由它派生（S64）。 */
    submitted: z.boolean(),
    /**
     * 已动作的玩家 ID 列表（S41 的左侧面板「已提交 / 未提交、已投票 / 未投票」）：
     * 动手期＝本步已提交者，投票期＝该链已投票者。只有 id，不含计数、也不含选择（S42 票行匿名），
     * 来源是接龙结构上的权威提交集与票箱——成员状态零新增字段（S64），一切在快照期派生。
     */
    submittedPlayerIds: z.array(z.string().uuid()),
    /** 步 1 选词期：我自己的候选词（绝不下发候选词池或其他人的候选）。 */
    wordOptions: z.array(z.object({ id: WordIdSchema, text: z.string() }).strict()).optional(),
    /** 步 1 选词期：是否还能「换一批」。 */
    canReroll: z.boolean().optional(),
    /** 题面：步 1 我选的词 / 步 3 上家的猜词文本；猜词步与复盘期不下发。 */
    prompt: z.string().optional(),
    /** 作画棒（步 1/3）：我自己的画布，可绘制。 */
    ownCanvas: RelayCanvasSchema.optional(),
    /** 猜词棒（步 2/4）：上家的画作，只读。 */
    previousDrawing: RelayCanvasSchema.optional(),
    /** 上一家 chip：步 2/4 = 画者（带画笔角标）、步 3 = 出题者（不带）；步 1 无上一家。 */
    previousArtist: RelayPlayerRefSchema.optional(),
    /** 复盘期（relay_showcase / relay_vote）内容。 */
    showcase: RelayShowcaseSchema.optional(),
    /** 终局榜（仅 `game_result`）：只有名次、分数与接龙口径统计，无称号、无链明细（S33）。 */
    finalRanking: z.array(RelayFinalRankingEntrySchema).optional(),
    /**
     * 终局最短展示期截止时间（仅 `game_result`）：与经典结算退出状态机同口径
     * （见 docs/game-result-exit.md），在此之前任何请求都不能全局返回等待。
     */
    gameResultMinEndsAt: z.number().optional(),
    /** 当前观看者现在是否可执行房主全局返回（仅 `game_result`，且已过最短展示期）。 */
    canReturnWaiting: z.boolean().optional(),
    /** 房间自由聊天流（全部成员可见的社交频道，与作答完全分离）。 */
    messages: z.array(ChatMessageSchema),
  })
  .strict()

export const RoomSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    hostId: z.string().uuid(),
    visibility: z.enum(['public', 'private']),
    /** 房间玩法：与可见性同级、创建时确定、房间内不可修改（S28）；客户端据此分流快照与界面。 */
    gameMode: GameModeSchema,
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
    /** 接龙视图：仅接龙房间下发；经典房间与经典门禁路径完全不动（S57）。 */
    relay: RelayGameViewSchema.optional(),
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
