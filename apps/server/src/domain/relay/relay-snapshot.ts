/**
 * 接龙视图构建器（S35 / S63）：按观看者单兵裁剪出**最小集**的 `RelayGameView`。
 *
 * 裁剪矩阵（角色 × 接龙阶段 × 步骤 × 链归属），链 j 的第 s 棒动手者是链 (j + s - 1) 的发起人（S9）：
 *
 * | 阶段（步骤） | 观看者本棒的链 | 下发内容 |
 * | --- | --- | --- |
 * | `relay_choose`（步 1） | 自己发起的那条 | **自己的**候选 + 换批权限 |
 * | `relay_draw`（步 1） | 自己发起的那条 | 自己的题面（自己选的词）+ 自己的第一幅画布 |
 * | `relay_draw`（步 3） | 向前回退 2 条 | 上家猜出的**文本**（看不到上家的画）+ 自己的第二幅画布 + 上家 chip（无画笔角标） |
 * | `relay_guess`（步 2） | 向前回退 1 条 | 上家的第一幅画作（只读）+ 上家 chip（带画笔角标） |
 * | `relay_guess`（步 4） | 向前回退 3 条 | 上家的第二幅画作（只读）+ 上家 chip（带画笔角标） |
 * | `relay_showcase` / `relay_vote` | —— | 阶段骨架（复盘与投票内容归工单 07/08） |
 *
 * 任何一格都**绝不下发**：其余链的画作与答案、未揭晓的答案（连长度也不给，S81 的占位由客户端按固定位数渲染）、
 * 他人的候选词池（S31）、以及全部提交 / 投票的归属记录（S35 / S63）。
 * `messages` 是房间级自由聊天流，与作答彻底分离（S79 / S20）。
 *
 * 本模块只读快照：不修改任何权威状态，因此可以在快照矩阵里脱离整机服务独立穷举。
 */
import { APP_CONFIG } from '../../config/index.ts'
import type { RelayGameView, RoomPhase } from '@draw-guess/shared'
import type { DrawingCanvasState } from '../drawing/drawing-core.ts'
import type { PlayerSecret, RoomSecret } from '../../models.ts'
import { relayChainIndexOf } from './relay-canvas-target.ts'

/** 视图构建所需的最小读取端口：chip 只用到玩家昵称与头像。 */
export interface RelayViewPort {
  players: ReadonlyMap<string, Pick<PlayerSecret, 'profile'>>
}

/**
 * 接龙阶段白名单：`starting`（开局倒计时）等非接龙阶段不下发接龙视图——
 * `RelayGameView.phase` 只能是接龙子集（S22 / S23）。
 */
const RELAY_VIEW_PHASES = [
  'relay_choose',
  'relay_draw',
  'relay_guess',
  'relay_showcase',
  'relay_vote',
] as const satisfies readonly RoomPhase[]

function isRelayViewPhase(phase: RoomPhase): phase is RelayGameView['phase'] {
  return RELAY_VIEW_PHASES.some((candidate) => candidate === phase)
}

/** 把权威画布裁剪成下发形状：只带重放需要的四个字段（与经典 GameView 的绘图字段同形）。 */
function toCanvasView(canvas: DrawingCanvasState): RelayGameView['ownCanvas'] {
  return {
    strokes: canvas.strokes,
    undoneStrokeIds: canvas.undoneStrokeIds,
    lastSequence: canvas.lastSequence,
    drawingRevision: canvas.drawingRevision,
  }
}

/** 按观看者裁剪接龙视图的构建器。 */
export class RelaySnapshotBuilder {
  constructor(private readonly port: RelayViewPort) {}

  /** 生成观看者的接龙视图；房间没有接龙局或当前不是接龙阶段时返回 undefined。 */
  build(room: RoomSecret, viewerId: string): RelayGameView | undefined {
    const relay = room.relay
    if (!relay || !isRelayViewPhase(room.phase)) return undefined
    const viewerIndex = relay.chains.findIndex((chain) => chain.originPlayerId === viewerId)
    const view: RelayGameView = {
      phase: room.phase,
      currentStep: relay.currentStep,
      stepId: relay.stepId,
      phaseStartedAt: relay.phaseStartedAt,
      phaseEndsAt: relay.phaseEndsAt,
      // 我是否已提交本步：权威记录挂接龙结构，快照期派生（S64）
      submitted: relay.stepSubmissions.has(viewerId),
      // 房间自由聊天流：与经典视图同源口径（只取最近 N 条）
      messages: relay.messages.slice(-APP_CONFIG.ui.recentMessageCount),
    }
    // 不在本局链阵容中的成员（残留连接）只拿阶段骨架：链内容一律按「观看者本棒」裁剪
    if (viewerIndex < 0) return view
    const chainCount = relay.chains.length
    const chain = relay.chains[relayChainIndexOf(chainCount, viewerIndex, relay.currentStep)]
    if (!chain) return view

    if (room.phase === 'relay_choose') {
      return {
        ...view,
        // 只下发**自己的**候选：候选按链隔离存放，他人的候选词池绝不出现（S31 / S35）
        wordOptions: chain.candidates.map(({ id, text }) => ({ id, text })),
        // 换批权限：房间开启且本链尚未用过（与经典 canReroll 同口径）
        canReroll: room.settings.allowWordReroll && !chain.rerollUsed,
      }
    }

    if (room.phase === 'relay_draw') {
      // 步 1 画自己选的词、写第一幅画布；步 3 按上家猜出的文本画、写第二幅画布
      const isFirstStep = relay.currentStep === 1
      const prompt = isFirstStep ? chain.step1Word?.text : chain.step2Guess
      // 步 3 的上一家是「出题者」：他给的是文本不是画，chip 因此不带画笔角标（S74）
      const previousArtist = isFirstStep
        ? undefined
        : this.playerRef(
            room,
            relay.chains[relayChainIndexOf(chainCount, viewerIndex, 2)]?.originPlayerId,
          )
      return {
        ...view,
        ...(prompt ? { prompt } : {}),
        ownCanvas: toCanvasView(isFirstStep ? chain.step1Canvas : chain.step3Canvas),
        ...(previousArtist ? { previousArtist } : {}),
      }
    }

    if (room.phase === 'relay_guess') {
      // 猜词棒只有步 2/4：步 2 看该链第一幅画、步 4 看第二幅；画者就是链发起人（带画笔角标）
      const previousArtist = this.playerRef(room, chain.originPlayerId)
      return {
        ...view,
        previousDrawing: toCanvasView(
          relay.currentStep === 2 ? chain.step1Canvas : chain.step3Canvas,
        ),
        ...(previousArtist ? { previousArtist } : {}),
      }
    }

    // 复盘 / 投票：本单只给阶段骨架，`showcase` 内容归工单 07/08
    return view
  }

  /** chip 用的极小资料：身份缺失时用成员冻结资料兜底（离局成员的链位仍会被展示，S37）。 */
  private playerRef(
    room: RoomSecret,
    playerId: string | undefined,
  ): RelayGameView['previousArtist'] {
    if (!playerId) return undefined
    const member = room.members.find((candidate) => candidate.playerId === playerId)
    const profile = member?.leftProfile ?? this.port.players.get(playerId)?.profile
    if (!profile) return undefined
    return { id: playerId, nickname: profile.nickname, avatarId: profile.avatarId }
  }
}
