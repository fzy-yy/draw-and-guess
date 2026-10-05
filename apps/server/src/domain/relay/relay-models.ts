/**
 * 接龙秘密状态模型（S56 / S64）。
 *
 * 与经典 `GameSecret` 并列挂在 `RoomSecret.relay`（`gameMode` 保证恰好一个非空）。
 * 链的两幅画布直接复用绘图内核的画布状态面（`DrawingCanvasState`），因此命令历史、三档预算
 * 与撤销重做栈无需为接龙另写一套（S45 / S49）；成员状态零新增字段——提交与投票的权威记录
 * 全部挂在这里（S64），左侧面板的「已提交 / 已投票」在快照期派生。
 *
 * 工单 05 起已落地「开局 → 步 1 选词 → 步 1 作画 → 进入步 2」所需的字段：
 * 按链隔离的候选词与换批状态（`RelayChainSecret.candidates` / `offeredWordIds` / `rerollUsed`）、
 * 本步已提交集（`RelayGameSecret.stepSubmissions`）与房间自由聊天流（`RelayGameSecret.messages`，S79）。
 * 工单 06 补齐步 2–4 的换手与掉队容错：四棒产出的写入口（`step2Guess` / `step4Guess` / 第二幅画布）
 * 与本步代交计时器（`autoSubmitTimers`，S8 / S16）。工单 07 补上复盘游标（`showcase`，链 / 半场 / 页）。
 * 工单 08 补上投票与终局：链上的票行（`votes`）与冻结的结算明细（`result`）、
 * 局上的终局榜（`finalRanking`）与结算退出时限（`gameResultMinEndsAt` / `hostReturnRequested` / `rematchTimer`）。
 * 成员状态始终零新增字段：投票与提交的权威记录全挂在这里，快照期派生（S64）。
 */
import type {
  ChatMessage,
  RelayFinalRankingEntry,
  RelayStep,
  RelayStepId,
  RelayVoteChoice,
  VocabularyWord,
} from '@draw-guess/shared'
import type { TimerHandle } from '../../runtime.ts'
import type { DrawingCanvasState } from '../drawing/drawing-core.ts'
import type { RelayShowcaseCursor } from './relay-showcase.ts'
import type { RelayChainVoteTally } from './relay-voting.ts'

/** 一条链的投票记录：按到达顺序入数组（S42）；倒计时结束后未投者由状态机补成不赞同（S14）。 */
export interface RelayChainVote {
  playerId: string
  choice: RelayVoteChoice
}

/** 一条接龙链：发起人、两幅画布、步 1 候选、四棒产出与投票（S64）。 */
export interface RelayChainSecret {
  /** 链发起人 = 步 1 的画者；链数组顺序即发起人席位顺序（S11 的复盘轮播序）。 */
  originPlayerId: string
  /** 步 1 的画布：发起人按自己选的词作画。 */
  step1Canvas: DrawingCanvasState
  /** 步 3 的画布：第三棒按步 2 猜出的文本作画（看不到上家的画）。 */
  step3Canvas: DrawingCanvasState
  /**
   * 步 1 的本链候选词（S31）：候选**按链隔离**存放、不跨链去重——
   * 链与链之间可以抽到同一个词，玩家只能看到自己那条链的候选（S35）。
   * 只对本链发起人生效：他选完即成为 `step1Word`。
   */
  candidates: VocabularyWord[]
  /** 本链是否已用过「换一批」：与经典「每回合一次」同口径，按链独立计数。 */
  rerollUsed: boolean
  /** 本链已展示过的词条 id：换批抽词的按链去重口径（S31），词池不足时才重置。 */
  offeredWordIds: Set<string>
  /** 步 1 产出：发起人选定的词（未选定前为空；选词 / 作画期只对该玩家可见，S35；投票期作为左胶囊向全房公开，S44）。 */
  step1Word?: VocabularyWord
  /** 步 2 产出：第二棒猜出的文本（同时是步 3 的题面）。 */
  step2Guess?: string
  /** 步 4 产出：第四棒猜出的文本（复盘第二半场的答案）。 */
  step4Guess?: string
  /**
   * 本链投票：按到达顺序追加（工单 08 写入 S42）。
   * 投票窗口内只含真实投票；倒计时结束时状态机把仍未投的链阵容成员补成 `disagree` 追加在行尾（S14），
   * 因此票行长度最终恒等于链阵容人数，且单元里没有「补票 vs 真投」的区分（无弃权）。
   */
  votes: RelayChainVote[]
  /**
   * 本链结算明细（投票窗口结束时算一次并冻结）：入账与终局统计都取这一份，不各算一遍（S13）。
   * 未走到投票的链（房主在作画期提前结束，S38）没有明细，票数与得分都按 0 处理。
   */
  result?: RelayChainVoteTally
}

/** 接龙局秘密状态：阶段时序、当前步骤、链数组、本步已提交集合与房间聊天流（S56 / S64）。 */
export interface RelayGameSecret {
  /** 本局 id（推送载荷里对位经典 `gameId`）。 */
  id: string
  /** 开局时间（epoch ms），与经典 `GameSecret.startedAt` 同口径。 */
  startedAt: number
  /** 当前步骤号（1～4，与房间阶段的作画 / 猜词交替同步）。 */
  currentStep: RelayStep
  /** 当前步骤的全局 id：该步所有玩家共用，服务端按 (观看者, stepId) 解析链画布（S53）。 */
  stepId: RelayStepId
  phaseStartedAt: number
  phaseEndsAt: number
  /** N 条链：开局时按席位顺序建立，离开者仍占链位由占位代交承接（S7 / S37）。 */
  chains: RelayChainSecret[]
  /** 本步已提交的玩家 ID 集合：快照里的「已提交 / 未提交」由它派生（S64）。 */
  stepSubmissions: Set<string>
  /**
   * 房间自由聊天流：接龙的聊天是独立社交频道（S79），与作答彻底分离——
   * 这里只可能收到 `chat:say` 的自由聊天与系统通知，作答永不进入（S20）。
   */
  messages: ChatMessage[]
  /** 主阶段计时器（与经典 `game.timer` 同口径，切阶段前清理）。 */
  timer?: TimerHandle
  /**
   * 复盘游标（工单 07）：当前链序号（1 起，席位顺序 S11）、半场与页（重播 / 停顿 / 揭晓，S43）。
   * 只在四步走完进入复盘后存在；切入该链投票时**保留**——投票期的快照仍要展示这条链的画作，
   * 且左胶囊固定为该链**初始词**（`step1Word`）、右胶囊固定为第四棒答案（`step4Guess`，S44），
   * 而不是继续沿半场口径（见 relay-snapshot 的双胶囊说明）；
   * 工单 08 在投票结束后凭它调用 `beginShowcaseForChain(chainIndex + 1)` 继续轮播。
   */
  showcase?: RelayShowcaseCursor
  /**
   * 终局榜（工单 08 首次进入 `game_result` 时一次性冻结，S33 / S37）：
   * 之后成员离房 / 退局都不再改变已公布的排名与统计。
   */
  finalRanking?: RelayFinalRankingEntry[]
  /** 终局最短展示期截止时间（与经典 `GameSecret.gameResultMinEndsAt` 同口径，见 docs/game-result-exit.md）。 */
  gameResultMinEndsAt?: number
  /** 房主在最短展示期内已请求全局返回；最短展示期到点后一次性执行（S60）。 */
  hostReturnRequested?: boolean
  /** 最短展示期计时器（到点评估全房 / 房主意愿），与 `timer`（无条件自动返回）成对。 */
  rematchTimer?: TimerHandle
}

/**
 * 一幅新画布的初始状态：序号基线 -1（第一条合法命令从 0 开始），与经典开局的画布口径一致。
 * 每幅画独立一套计数（命令数即历史长度、点数与填充次数各自累计），因此两幅画都从零起算（S45）。
 */
export function createRelayCanvasState(): DrawingCanvasState {
  return {
    strokes: [],
    undoneStrokeIds: [],
    lastSequence: -1,
    strokePointTotal: 0,
    fillCount: 0,
    drawingRevision: 0,
  }
}

/** 新建一条链：两幅空画布 + 空票箱，四棒产出待各棒写入（工单 05 开局时按席位顺序调用）。 */
export function createRelayChainSecret(originPlayerId: string): RelayChainSecret {
  return {
    originPlayerId,
    step1Canvas: createRelayCanvasState(),
    step3Canvas: createRelayCanvasState(),
    // 候选与换批状态在进入步 1 选词时由状态机填充（工单 05）。
    candidates: [],
    rerollUsed: false,
    offeredWordIds: new Set(),
    votes: [],
  }
}
