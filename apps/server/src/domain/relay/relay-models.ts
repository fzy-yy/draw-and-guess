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
 * 代交内容归工单 06、复盘游标归工单 07、投票结算归工单 08，各自落地时增量补齐（本文件不预置空占位字段）。
 */
import type {
  ChatMessage,
  RelayStep,
  RelayStepId,
  RelayVoteChoice,
  VocabularyWord,
} from '@draw-guess/shared'
import type { TimerHandle } from '../../runtime.ts'
import type { DrawingCanvasState } from '../drawing/drawing-core.ts'

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
  /** 步 1 产出：发起人选定的词（未选定前为空；只对该玩家可见，S35）。 */
  step1Word?: VocabularyWord
  /** 步 2 产出：第二棒猜出的文本（同时是步 3 的题面）。 */
  step2Guess?: string
  /** 步 4 产出：第四棒猜出的文本（复盘第二半场的答案）。 */
  step4Guess?: string
  /** 本链投票：按到达顺序追加（工单 08 写入）。 */
  votes: RelayChainVote[]
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
