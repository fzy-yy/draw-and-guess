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
 * | `relay_guess`（步 2） | 向前回退 1 条 | 上家的第一幅画作（只读）+ **画这幅画的人**（链发起人）chip（带画笔角标） |
 * | `relay_guess`（步 4） | 向前回退 3 条 | 上家的第二幅画作（只读）+ **画这幅画的人**（第三棒）chip（带画笔角标） |
 * | `relay_showcase`（游标所在链） | 全员同一份 | 当前链本半场的题面 / 画作（全量 strokes）/ 猜词者 chip；答案仅揭晓页给文本 |
 * | `relay_vote`（游标所在链） | 全员同一份 | 同上，且答案已揭晓（投票卡要用两个答案）；匿名票行归工单 08 |
 *
 * 任何一格都**绝不下发**：其余链的画作与答案、未揭晓的答案（连长度也不给，S81 的占位由客户端按固定位数渲染）、
 * 他人的候选词池（S31）、以及全部提交 / 投票的归属记录（S35 / S63）。
 * `messages` 是房间级自由聊天流，与作答彻底分离（S79 / S20）。
 *
 * 本模块只读快照：不修改任何权威状态，因此可以在快照矩阵里脱离整机服务独立穷举。
 */
import { APP_CONFIG } from '../../config/index.ts'
import { serverStrings } from '@draw-guess/strings'
import type { RelayCanvas, RelayGameView, RelayPlayerRef, RoomPhase } from '@draw-guess/shared'
import type { DrawingCanvasState } from '../drawing/drawing-core.ts'
import type { RelayGameSecret } from './relay-models.ts'
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
function toCanvasView(canvas: DrawingCanvasState): RelayCanvas {
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
      // 步 3 的上一家是「出题者」（步 2 的动手者）：他给的是文本不是画，chip 因此不带画笔角标（S74）
      const previousArtist = isFirstStep
        ? undefined
        : this.playerRef(room, this.previousActorId(relay, viewerIndex))
      return {
        ...view,
        ...(prompt ? { prompt } : {}),
        ownCanvas: toCanvasView(isFirstStep ? chain.step1Canvas : chain.step3Canvas),
        ...(previousArtist ? { previousArtist } : {}),
      }
    }

    if (room.phase === 'relay_guess') {
      // 猜词棒只有步 2/4：步 2 看该链第一幅画（链发起人画的）、步 4 看第二幅（第三棒画的）；
      // chip 的画笔角标语义＝「你正在看的这幅画是谁画的」，因此两棒的画者不是同一人（S74）
      const previousArtist = this.playerRef(room, this.previousActorId(relay, viewerIndex))
      return {
        ...view,
        previousDrawing: toCanvasView(
          relay.currentStep === 2 ? chain.step1Canvas : chain.step3Canvas,
        ),
        ...(previousArtist ? { previousArtist } : {}),
      }
    }

    // 复盘 / 投票：只公开**当前链**（游标指向的那条），且只在该链轮播到的那半场（S32 / S63）。
    // 对链阵容内的成员，展示期是公开复盘（S35）：不按观看者裁剪，所有人看到同一份内容。
    const cursor = relay.showcase
    if (!cursor) return view
    const currentChain = relay.chains[cursor.chainIndex - 1]
    // 半场 1＝第 1/2 棒（画家 = 链发起人 +0、猜词者 +1）；半场 2＝第 3/4 棒（+2 / +3）。
    // 偏移即 S9 的环状顺延：链 j 的第 s 棒动手者是链 j+s-1 的发起人。
    const actorAt = (offset: number) =>
      relay.chains[(cursor.chainIndex - 1 + offset) % chainCount]?.originPlayerId
    const artistId = actorAt(cursor.half === 1 ? 0 : 2)
    const guesserId = actorAt(cursor.half === 1 ? 1 : 3)
    // 残缺现场（游标越界 / 链数组不全）：只给阶段骨架，绝不猜一条链出来（fail-safe 不泄漏）
    if (!currentChain || !artistId || !guesserId) return view
    // 题面：半场 1＝发起人选的词；半场 2＝第二棒猜出的文本（它同时是第三棒的题面）。
    // 两个值在轮播到本半场时都已公开（半场 2 的题面正是半场 1 揭晓的那个答案）。
    const prompt = cursor.half === 1 ? currentChain.step1Word?.text : currentChain.step2Guess
    // 答案：未揭晓（重播 / 停顿页）时 text 为 null——不下发文本、也不下发长度（S81），
    // 客户端用经典遮罩同款的固定位数下划线占位。
    const answer = cursor.half === 1 ? currentChain.step2Guess : currentChain.step4Guess
    return {
      ...view,
      showcase: {
        chainIndex: cursor.chainIndex,
        chainCount,
        half: cursor.half,
        prompt: { player: this.showcaseChip(room, artistId), text: prompt ?? null },
        answer: {
          player: this.showcaseChip(room, guesserId),
          text: cursor.page === 'reveal' ? (answer ?? null) : null,
        },
        // 重播的画作：半场 1＝第一幅、半场 2＝第二幅，**全量 strokes** 供客户端只读重放（S32）；
        // 空白画布保持空白、不加任何标注（S66）。
        drawing: toCanvasView(
          cursor.half === 1 ? currentChain.step1Canvas : currentChain.step3Canvas,
        ),
      },
    }
  }

  /**
   * 复盘 chip 的玩家资料：复盘只有两个固定位置（画家 / 猜词者），两处都必须有名有姓，
   * 因此这里不做对局期 `playerRef` 的「查不到就省略 chip」处理——链位在成员离场后依然占着（S7），
   * 资料已随身份回收（离房 + 重连宽限超时）时回落到中性占位身份（与经典 `nicknameOf` 的兜底同口径），
   * 轮播绝不为一个人的资料缺失而断（S12）。
   */
  private showcaseChip(room: RoomSecret, playerId: string): RelayPlayerRef {
    return (
      this.playerRef(room, playerId) ?? {
        id: playerId,
        nickname: serverStrings.notices.fallbackPlayerName,
        avatarId: APP_CONFIG.player.defaultAvatarId,
      }
    )
  }

  /**
   * 观看者本棒的**上一棒动手者**（他给的画 / 文本就是本棒的全部输入，S35）：
   * 链 j 的第 s 棒动手者是链 (j + s - 1) 的发起人（S9），于是「我本棒的链的第 s-1 棒动手者」
   * 恰好是席位排在我前一位的链发起人——与步号无关（每换一棒，动手者整体顺延一位）。
   * 步 2/4 的画者 chip 与步 3 的出题者 chip 共用这一处解析，避免同一环状关系在两处漂移。
   */
  private previousActorId(relay: RelayGameSecret, viewerIndex: number): string | undefined {
    const previousIndex = (viewerIndex - 1 + relay.chains.length) % relay.chains.length
    return relay.chains[previousIndex]?.originPlayerId
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
