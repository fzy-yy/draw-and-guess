/**
 * 服务端内存领域模型。
 * 带 Secret 后缀的数据绝不原样发送给客户端；公开快照必须通过 GameService 的裁剪函数生成。
 */
import type { Socket } from 'socket.io'
import type {
  Ack,
  ChatMessage,
  PresencePreferences,
  Profile,
  RoomPhase,
  RoomSettings,
  RoomVisibility,
  DrawingCommand,
  RoundResult,
  VocabularyItem,
} from '@draw-guess/shared'

/**
 * 玩家在服务端内存中的秘密状态。
 * 所有带 Secret 的数据绝不原样发送给客户端；公开视图必须通过 GameService 的裁剪函数生成。
 */
export interface PlayerSecret {
  id: string // 玩家唯一 ID（UUID）
  token: string // 服务端签发的临时恢复令牌（仅当前进程内有效）
  profile: Profile // 昵称与内置 SVG 头像编号
  preferences: PresencePreferences // 发现/邀请偏好
  socket?: Socket // 当前活跃的 Socket 连接（断线重连时会替换）
  socketId?: string // 当前连接 ID，用于防串号
  roomId?: string // 所在房间（不在房间则为 undefined）
  connected: boolean // 是否在线（断线宽限期内为 false）
  joinedAt: number // 注册时间戳
  disconnectedAt?: number // 最近断线时间戳（用于宽限期判断）
  disconnectTimer?: NodeJS.Timeout // 断线清理定时器
  requestCache: Map<string, Ack<unknown>> // event + requestId → 完整 ack 的幂等缓存
  lastInviteAt: Map<string, number> // 目标玩家 ID → 最近邀请时间（限频）
  /** 一秒滑动窗口内的猜词与绘图事件时间，用于局域网刷包保护。 */
  guessEventTimes: number[]
  drawEventTimes: number[]
  /** 私密房间码尝试时间窗口，独立于通用事件限频以阻止短码枚举。 */
  privateJoinAttemptTimes: number[]
}

/** 房间内成员状态：独立于玩家身份，随房间生命周期存在。 */
export interface MemberState {
  playerId: string // 对应玩家 ID
  /** 是否为观战成员：不参与准备/画家轮换/猜词/计分，游戏中加入时置位。 */
  spectating?: boolean
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
  roundId: string // 当前回合 ID（每回合重新生成）
  phaseStartedAt: number // 当前阶段开始时间
  phaseEndsAt: number // 当前阶段权威结束时间
  phaseBeforePause?: RoomPhase // 暂停前的阶段
  pausedRemainingMs?: number // 暂停时冻结的剩余毫秒
  currentRound: number // 当前回合序号（从 1 开始）
  totalRounds: number // 总回合数 = 人数 × 每人轮数
  drawerOrder: string[] // 画家轮换顺序（开局时洗牌）
  drawerId: string // 当前画家
  candidates: VocabularyItem[] // 当前回合候选词（仅画家可见）
  answer?: VocabularyItem // 当前回合答案（选定后置位）
  usedWordIds: Set<string> // 已用过的词条 ID（避免回合重复）
  /** 自由笔画与区域填充共用一条内存历史，支持统一撤销、重做与重连恢复。 */
  strokes: DrawingCommand[]
  undoneStrokeIds: string[] // 已撤销命令 ID 栈（先进后出）
  lastSequence: number // 已接受的绘图序号（拒绝旧包）
  messages: ChatMessage[] // 回合聊天消息（入队裁剪）
  correctOrder: string[] // 猜中者 ID 按时间排序
  revealedIndices: Set<number> // 逐步提示已揭示的字符下标
  roundResult?: RoundResult // 回合结算数据
  timer?: NodeJS.Timeout // 主阶段计时器
  /** 绘图阶段的逐步提示计时器，与主阶段计时器一起在暂停/切换时清理。 */
  hintTimers?: NodeJS.Timeout[]
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
  selectedWordIds: Set<string> // 本局启用的词条 ID 集合
  game?: GameSecret // 对局进行中才有
  createdAt: number
}

/** 定向邀请秘密状态：过期后由定时器自动回收。 */
export interface InviteSecret {
  id: string
  fromPlayerId: string // 邀请者
  toPlayerId: string // 被邀请者
  roomId: string
  expiresAt: number // 过期时间戳
  timer: NodeJS.Timeout // 过期清理定时器
}
