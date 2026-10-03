/**
 * 服务端内存领域模型。
 * 带 Secret 后缀的数据绝不原样发送给客户端；公开快照必须通过 GameService 的裁剪函数生成。
 */
import type {
  Ack,
  ChatMessage,
  PresencePreferences,
  Profile,
  RoomPhase,
  RoomSettings,
  RoomVisibility,
  DrawingCommand,
  FinalRankingEntry,
  RoundResult,
  ScoreDetail,
  VocabularyWord,
} from '@draw-guess/shared'
import type { AppSocket } from './socket-types.ts'
import type { TimerHandle } from './runtime.ts'

/** 服务端内部持有的聊天消息记录：包含可选的私密接收人 recipientId。 */
export interface ServerChatMessage extends ChatMessage {
  /** 若指定，则该消息为该玩家专属私密提示（如差一字提醒），快照下发时仅其本人可见。 */
  recipientId?: string
}
/**
 * 玩家在服务端内存中的秘密状态。
 * 所有带 Secret 的数据绝不原样发送给客户端；公开视图必须通过 GameService 的裁剪函数生成。
 */
export interface PlayerSecret {
  id: string // 玩家唯一 ID（UUID）
  tokenDigest: string // 恢复令牌摘要；明文只在签发调用栈中短暂存在并返回客户端
  profile: Profile // 昵称与内置 SVG 头像编号
  preferences: PresencePreferences // 发现/邀请偏好
  socket?: AppSocket // 当前活跃的 Socket 连接（断线重连时会替换）
  socketId?: string // 当前连接 ID，用于防串号
  roomId?: string // 所在房间（不在房间则为 undefined）
  connected: boolean // 是否在线（断线宽限期内为 false）
  joinedAt: number // 注册时间戳
  disconnectedAt?: number // 最近断线时间戳（用于宽限期判断）
  /** 在作画阶段断线时保留的房间 ID；用于重连后只向同局成员广播恢复提示。 */
  drawingDisconnectRoomId?: string
  /** 每次有效断线递增；画家/房主短宽限回调只处理创建它的断线代次。 */
  disconnectGeneration: number
  disconnectTimer?: TimerHandle // 断线清理定时器
  requestCache: Map<string, Ack<unknown>> // event + requestId → 完整 ack 的幂等缓存
  lastInviteAt: Map<string, number> // 目标玩家 ID → 最近邀请时间（限频）
  /** 一秒滑动窗口内的猜词与绘图事件时间，用于局域网刷包保护。 */
  guessEventTimes: number[]
  drawEventTimes: number[]
  /** 画布微表情 1.5 秒滑动窗口限频时间队列。 */
  canvasReactionTimes?: number[]
  /** 私密房间码尝试时间窗口，独立于通用事件限频以阻止短码枚举。 */
  privateJoinAttemptTimes: number[]
}

/** 房间内成员状态：独立于玩家身份，随房间生命周期存在。 */
export interface MemberState {
  playerId: string // 对应玩家 ID
  seatIndex: number // 固定席位序号，对局内颜色与玩家身份据此保持稳定
  /** 是否为观战成员：不参与准备/画家轮换/猜词/计分，游戏中加入时置位。 */
  spectating?: boolean
  /** 是否为下一局候场成员：当前局按观战权限裁剪，回到 waiting 时自动转为普通未准备成员。 */
  waitingForNextGame?: boolean
  /** 最终结算中本成员是否已表达“再来一局”；进入 waiting 时清除。 */
  rematchReady?: boolean
  /** 主动退出本局后保留结果卡片，但不再参与房间裁决或接收房间快照。 */
  leftGame?: boolean
  /** 退出时冻结公开资料，避免玩家进入其它房间后旧对局卡片发生变化。 */
  leftProfile?: Profile
  ready: boolean // 是否已准备
  score: number // 本局累计得分
  joinedAt: number // 加入房间时间戳
  guessedAt?: number // 本回合猜中时间戳（猜中后置位）
  stats: {
    correctCount: number // 累计猜中次数
    totalGuessMs: number // 累计猜中用时
    drawingCorrectCount: number // 作画带动的猜中人次
  }
  /** 本成员已收到增量广播的最新绘图序号（快照差分用）：null/落后时快照需全量下发画布。 */
  lastSyncedSeq?: number
}

/** 一局游戏的秘密状态：只存在于进程内存，永不写入磁盘。 */
export interface GameSecret {
  id: string // 本局游戏 ID
  /** 开局时间（epoch ms），用于战报归档（game_archive.started_at）。 */
  startedAt: number
  roundId: string // 当前回合 ID（每回合重新生成）
  phaseStartedAt: number // 当前阶段开始时间
  phaseEndsAt: number // 当前阶段权威结束时间
  /**
   * 暂停现场：暂停前阶段与冻结的剩余毫秒成对存在（半状态由类型消除，恢复时无需兜底）。
   * 恢复/结算/清场时整体删除；只有可暂停阶段（choosing_word/drawing/round_result）会写入。
   */
  pauseState?: { phase: RoomPhase; remainingMs: number }
  currentRound: number // 当前回合序号（从 1 开始）
  totalRounds: number // 总回合数 = 人数 × 每人轮数
  /** 当前回合实际作画时长（毫秒）：只取房间单回合时长，计分与逐步提示调度统一用它 */
  roundDurationMs: number
  drawerOrder: string[] // 画家轮换顺序（开局时洗牌）
  drawerId: string // 当前画家
  candidates: VocabularyWord[] // 当前回合候选词（富模型，仅画家可见）
  rerollUsed?: boolean // 当前回合是否已使用“换一组”
  answer?: VocabularyWord // 当前回合答案（选定后置位；含别称/分类）
  offeredWordIds: Set<string> // 本局已展示过的候选词 ID 集合（整局游戏中候选词绝不重复）
  /** 自由笔画与区域填充共用一条内存历史，支持统一撤销、重做与重连恢复。 */
  strokes: DrawingCommand[]
  undoneStrokeIds: string[] // 已撤销命令 ID 栈（先进后出）
  lastSequence: number // 已接受的绘图序号（拒绝旧包）
  /** 当前回合已累计的绘图点数（含填充按 1 计），用于 maxPointsPerRound 预算。 */
  strokePointTotal: number
  /** 当前回合已提交的填充命令数，用于 maxFillsPerRound 预算（限制重连全量重放成本）。 */
  fillCount: number
  messages: ServerChatMessage[] // 回合聊天消息（含独占私密通知标记，入队裁剪）
  correctOrder: string[] // 猜中者 ID 按时间排序
  /**
   * 猜中当时的得分明细（与入账同一条记录）。
   * 结算展示直接取用本数组，不事后重算，保证「展示的分数」与「实际入账的分数」一致。
   */
  correctDetails: ScoreDetail[]
  revealedIndices: Set<number> // 逐步提示已揭示的字符下标
  drawingRevision: number // 画布修订代次，增量操作单调递增
  // 战报防重不设标志位：finishGame 以 finalRanking 是否已置 + 仓储幂等 upsert 兜底。
  roundResult?: RoundResult // 回合结算数据
  /** 进入最终结算时冻结；成员随后离房不会改变已公布的排名与统计。 */
  finalRanking?: FinalRankingEntry[]
  /** 最终结算最短展示截止时间；在此之前任何请求都不能全局返回等待。 */
  gameResultMinEndsAt?: number
  /** 房主在最短展示期内点击后记账，到期即执行一次全局返回。 */
  hostReturnRequested?: boolean
  timer?: TimerHandle // 主阶段计时器
  /** 最短展示期计时器；与最终结算自动返回主计时器分离。 */
  rematchTimer?: TimerHandle
  /** 绘图阶段的逐步提示计时器，与主阶段计时器一起在暂停/切换时清理。 */
  hintTimers?: TimerHandle[]
}

/** 房间秘密状态：成员席位、规则、词库选择与对局引用。 */
export interface RoomSecret {
  id: string
  name: string
  hostId: string // 房主玩家 ID（可迁移）
  visibility: RoomVisibility
  /** 服务端生成的私密房间码；仅通过角色裁剪快照向当前房主显示。 */
  privateJoinCode?: string
  phase: RoomPhase
  stateVersion: number // 状态版本号（乐观并发控制）
  settings: RoomSettings
  members: MemberState[] // 成员席位（顺序即加入顺序）
  vocabularyPackageId?: string // 本局绑定的词库包 ID（缺省为词数最多者）
  selectedWordIds: Set<string> // 本局启用的词条 ID 集合
  game?: GameSecret // 对局进行中才有
}

/** 定向邀请秘密状态：过期后由定时器自动回收。 */
export interface InviteSecret {
  id: string
  fromPlayerId: string // 邀请者
  toPlayerId: string // 被邀请者
  roomId: string
  expiresAt: number // 过期时间戳
  timer: TimerHandle // 过期清理定时器
}
