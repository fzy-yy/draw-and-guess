/** 房间所处的对局阶段；服务端状态机只允许发生显式合法的转换。 */
export type RoomPhase =
  | 'waiting' // 等待阶段：可加入、可改规则、可准备
  | 'starting' // 开始倒计时中（短暂过渡阶段）
  | 'choosing_word' // 画家正在从候选词中选题
  | 'drawing' // 作画与猜词阶段
  | 'round_result' // 单回合结算展示阶段
  | 'paused' // 全局暂停（所有计时冻结）
  | 'game_result' // 最终结算展示阶段
  | 'closed' // 房间已关闭（不可再加入）

/** 成员与服务器的连接状态（仅表示是否在线，与玩家在场状态无关）。 */
export type ConnectionState = 'online' | 'reconnecting' | 'left'
/** 玩家在场状态：空闲 / 在房间中 / 正在对局 / 断线恢复宽限期。 */
export type PresenceStatus = 'idle' | 'in_room' | 'playing' | 'reconnecting'
/** 画布工具类型：画笔、橡皮擦、封闭区域填充。 */
export type ToolKind = 'pen' | 'eraser' | 'fill'
/** 房间可见性：公开房进入大厅列表，私密房只能通过房间码或定向邀请加入。 */
export type RoomVisibility = 'public' | 'private'
/** 内置 SVG 头像的稳定白名单编号；具体图形仅由客户端本地资源映射。 */
export type AvatarId = (typeof import('../../../config.ts').APP_CONFIG.player.avatarIds)[number]

/** 玩家的公开身份资料：昵称 + 内置 SVG 头像编号。 */
export interface Profile {
  nickname: string
  avatarId: AvatarId
}

/** 玩家的公开发现偏好：是否允许被其他玩家发现 / 是否接收邀请。 */
export interface PresencePreferences {
  discoverable: boolean
  acceptsInvites: boolean
}

/** 大厅「在线玩家」列表中展示的公开玩家信息（不含任何房间秘密）。 */
export interface PublicPlayer {
  id: string
  nickname: string
  avatarId: AvatarId
  status: PresenceStatus
  roomId?: string
}

/** 房间成员视图：在公开玩家信息基础上叠加本局内的成员状态。 */
export interface RoomMember extends PublicPlayer {
  seatIndex: number // 固定席位序号（0～5），整局不随其他玩家退出而改变
  seatColor: string // 席位识别色，由服务端按配置裁剪下发
  ready: boolean // 是否已准备（观战者恒为 false）
  score: number // 本局累计得分
  isHost: boolean // 是否为房主
  isDrawer: boolean // 是否当前画家
  guessed: boolean // 本回合是否已猜中
  spectating: boolean // 是否为观战成员（不参与准备/作画/猜词/计分）
  leftGame: boolean // 是否已主动退出本局；保留灰色卡片但不再参与游戏
  connection: ConnectionState // 连接状态
  /** 服务端累计的公开局内统计，仅包含计数和时长，不暴露猜词正文。 */
  stats: {
    correctCount: number // 猜中次数
    totalGuessMs: number // 猜中累计用时（毫秒）
    drawingCorrectCount: number // 作画时带动的猜中人次
  }
}

/**
 * 最终结算排行项：进入 game_result 时由服务端一次性冻结。
 * 它不依赖仍在房间中的成员列表，因此结算后有人离房也不会让榜单重排或缺项。
 */
export interface FinalRankingEntry {
  id: string
  nickname: string
  avatarId: AvatarId
  rank: number // 同分并列时共享名次
  score: number
  stats: RoomMember['stats']
}

/** 房间规则；全部字段由服务端校验，客户端只能按配置允许的范围修改。 */
export interface RoomSettings {
  maxPlayers: number // 最大玩家数
  roundsPerPlayer: number // 每人作画轮数
  drawSeconds: number // 每回合作画秒数
  chooseSeconds: number // 选词阶段秒数
  optionCount: number // 每回合候选词个数
  showWordLength: boolean // 是否显示答案字数遮罩
  progressiveHints: boolean // 是否开启逐步提示（随时间揭示字符）
  /** 是否开启结构化提示（词条 hint 字段按阈值逐条揭示，HUD 随机展示其中一条） */
  structuredHintsEnabled: boolean
  /** 结构化提示开始时机：剩余时间比例降到该值时揭示词条分类（0.05~0.9）；词库单分类即单条提示 */
  hintStartRatio: number
  /** 统一猜词基础分：本局内猜中者的基础得分（覆盖全局默认值） */
  guessBaseScore: number
  /** 猜词分数计算方式：standard=基础+速度+顺序；flat=仅固定基础分 */
  scoreMode: 'standard' | 'flat'
  allowPlayerInvite: boolean // 普通玩家是否可邀请
  allowPause: boolean // 是否允许暂停
  joinPolicy: 'forbid' | 'spectate' | 'next_game' // 对局中加入策略（首版固定为下一局）
}

/** 大厅房间列表行展示的公开房间摘要；私密房永不进入此结构。 */
export interface PublicRoom {
  visibility: 'public'
  id: string
  name: string
  hostName: string
  playerCount: number
  maxPlayers: number
  phase: RoomPhase
  roundsPerPlayer: number
  drawSeconds: number
  joinPolicy: RoomSettings['joinPolicy'] // 中途加入策略（大厅据此决定是否可发起观战加入）
}

/** 聊天消息：猜词、系统、猜中、预设短语与「很接近」提示共用此结构。 */
export interface ChatMessage {
  id: string
  type: 'guess' | 'system' | 'correct' | 'preset' | 'close'
  text: string
  playerId?: string // 仅玩家消息有来源
  createdAt: number
}

/** 画布上的归一化坐标点；x/y 均在 0～1 之间，缩放不漂移。 */
export interface DrawPoint {
  x: number
  y: number
}

/** 自由笔画命令；橡皮擦也是自由笔画，只改变合成模式（destination-out）。 */
export interface Stroke {
  kind: 'stroke'
  id: string
  tool: 'pen' | 'eraser'
  color: string
  width: number
  points: DrawPoint[]
  sequence: number
}

/** 封闭区域填充命令；点击位置使用归一化坐标，实际像素区域由各客户端重放历史后计算。 */
export interface FillCommand {
  kind: 'fill'
  id: string
  point: DrawPoint
  color: string
  sequence: number
}

/** 画布历史使用可判别联合，服务端可对笔画与填充命令执行严格校验。 */
export type DrawingCommand = Stroke | FillCommand

/** 单个玩家的回合得分明细：基础分 + 速度奖励 + 顺序奖励 = 总分。 */
export interface ScoreDetail {
  playerId: string
  base: number // 猜中基础分
  speed: number // 速度奖励（按剩余时间比例线性衰减）
  order: number // 猜中顺序奖励（前几名有额外加分）
  total: number // 三者之和
}

/** 单回合结算数据：只有结算阶段才随快照下发答案正文。 */
export interface RoundResult {
  answer: string // 本回合答案
  details: ScoreDetail[] // 猜中者得分明细
  drawerScore: number // 画家本回合得分
}

/** 对局视图：按观看者角色裁剪后的当前对局状态（快照的 game 字段）。 */
export interface GameView {
  gameId: string
  roundId: string // 回合唯一 ID，绘图与猜词请求必须携带
  phaseBeforePause?: RoomPhase // 暂停前的阶段，用于恢复
  currentRound: number
  totalRounds: number
  drawerId: string // 当前画家
  phaseStartedAt: number
  phaseEndsAt: number // 服务端权威的截止时间戳（毫秒）
  answerMask: string // 猜词者可见的答案遮罩（画家可见真实答案）
  answer?: string // 仅当前画家可见
  wordOptions?: Array<{ id: string; text: string; difficulty: number }> // 仅画家选词阶段可见（含难度星级）
  /** 已揭示的结构化提示（词库改为单分类即提示，按阈值揭示词条分类；列表至多一条） */
  revealedHints?: string[]
  strokes: DrawingCommand[] // 全部画布命令历史
  /** 是否省略 strokes（画布历史）：仅在该成员已在线同步全部增量时置位，客户端应沿用本地已有历史。 */
  strokesOmitted?: boolean
  undoneStrokeIds: string[] // 已撤销的命令 ID（用于重放过滤）
  lastSequence: number // 服务端已接受的绘图序号（供重连客户端续起 seq，避免被当旧包拒绝）
  messages: ChatMessage[] // 最近消息（服务端裁剪数量）
  roundResult?: RoundResult // 回合结算数据
  finalRanking?: FinalRankingEntry[] // 最终结算时冻结的权威排行
}

/** 房间完整快照：大厅行摘要 + 成员 + 规则 + 角色裁剪的对局视图。 */
export interface RoomSnapshot {
  id: string
  name: string
  hostId: string
  visibility: RoomVisibility
  /** 私密房间码只裁剪给当前房主，用于邀请线下伙伴加入。 */
  privateJoinCode?: string
  phase: RoomPhase
  stateVersion: number // 状态版本号，用于乐观并发控制
  settings: RoomSettings
  members: RoomMember[]
  selectedWordCount: number // 本局已选词条数
  totalWordCount: number // 词库总词条数
  game?: GameView // 对局中才有
}

/**
 * 会话注册成功后的权威结果。
 * `room: null` 是显式状态：表示该身份当前不在房间，客户端必须清除旧房间快照。
 */
export interface SessionRegistration {
  player: PublicPlayer
  recoveryToken: string
  restored: boolean
  room: RoomSnapshot | null
}

/** 作画阶段成员连接变化通知；仅用于即时 UI 提示，不参与任何游戏裁决。 */
export interface MemberConnectionChange {
  playerId: string
  nickname: string
  connection: ConnectionState
}

/**
 * 词库词条（富模型）：由服务端词库 Provider 在加载期校验并规范化产出，前后端共用。
 * 词库来源为 SQLite（words 表），单词条只有一个分类（category），
 * 该分类同时作为作画阶段的「猜词提示」（替代旧版 hint 列表），
 * 及其别称、难度、词条级时限/权重等维度，支撑别称判对、词条级时限、筛选与徽章等玩法与 UI。
 */
export interface VocabularyWord {
  /** 稳定唯一 ID；格式由词库来源决定（SQLite 实现 = 「sqlite:数字主键」字符串化），协议层不限定来源 */
  id: string
  /** 答案词面 */
  text: string
  /** 可被判定为正确答案的别称（与词面一样经规范化后比较） */
  aliases: string[]
  /** 唯一分类（必属词库 metadata 的 category_enum 白名单）；同时作为作画阶段的猜词提示 */
  category: string
  /** 难度 1~5，数值越大越难；用于选词星级与词库管理筛选 */
  difficulty: number
  /** 词条级作画时限（秒）；缺省回退词库缺省值，再回退房间规则；生效前经配置区间锾制 */
  timeLimit?: number
  /** 词条级计分权重；计分语义确认前仅透传预留，不参与计分 */
  scoreWeight?: number
}

/**
 * 词库快照：仅房主可见全部词条与当前选择。
 * categories 为词库文件的分类白名单（category_enum），供管理 UI 做筛选下拉。
 */
export interface VocabularySnapshot {
  items: VocabularyWord[]
  selectedIds: string[]
  version: string // 词库内容哈希版本
  categories: string[] // 分类白名单（供筛选下拉与字段统计）
}

/** 定向房间邀请：过期后将自动失效。 */
export interface Invite {
  id: string
  roomId: string
  roomName: string
  from: PublicPlayer
  expiresAt: number
}

/** 大厅在线状态快照：可发现玩家 + 全部公开房间。 */
export interface PresenceSnapshot {
  players: PublicPlayer[]
  rooms: PublicRoom[]
}

/**
 * 统一 ack 结构：所有可失败请求都返回此类型。
 * 成功时携带数据；失败时不泄露内部堆栈，只给错误码与可读消息。
 */
export type Ack<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string }; requestId: string }
