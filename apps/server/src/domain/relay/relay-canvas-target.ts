/**
 * 接龙绘图目标解析（纯逻辑，S9 / S53）。
 *
 * 输入「房间阶段 + 接龙局 + 观看者 + 步骤 id」，输出该观看者本棒要写的那条链的画布。
 * 步骤 id 是每一步一个、该步所有玩家共用（S53），因此「这是谁的棒次」只由观看者决定：
 * 链 j 的第 s 棒作画者是链 (j + s - 1) 的发起人（环状顺延，S9），
 * 于是观看者本棒的链＝以他为发起人的那条链向前回退 (s - 1) 条。
 *
 * 本模块只给领域原因：协议错误码与文案的映射在装配层（GameService），
 * 房间成员守卫、阶段到期与发布策略也都不在这里。
 */
import type { RelayStep, RoomPhase } from '@draw-guess/shared'
import type { DrawingCanvasState } from '../drawing/drawing-core.ts'
import type { RelayChainSecret, RelayGameSecret } from './relay-models.ts'
import { isDrawingStep, type RelayDrawingStep } from './relay-steps.ts'

/** 解析入参：房间当前阶段 + 接龙局秘密（房间没有接龙局时由装配层按 NO_GAME 拒绝）。 */
export interface RelayCanvasSource {
  phase: RoomPhase
  relay: RelayGameSecret
}

/** 解析拒绝原因（领域原因，协议错误码映射见 GameService）。 */
export type RelayCanvasRejection =
  /** 当前阶段或当前步骤不是作画棒（选词棒、猜词棒、复盘期）。 */
  | 'not-drawing-step'
  /** 步骤 id 与当前步不符：上一棒残留或提前使用下一棒的 id。 */
  | 'stale-step'
  /** 观看者不在本局链阵容中（非本局成员的残留连接）。 */
  | 'not-participant'
  /** 当前玩家在本棒已经完成提交锁定（S30：提交即锁定不可撤回，禁止继续修改画布）。 */
  | 'already-submitted'
/** 解析结果：本棒的作画步骤、链与要写入的画布。 */
export type RelayCanvasDecision =
  | {
      accepted: true
      value: { step: RelayDrawingStep; chain: RelayChainSecret; canvas: DrawingCanvasState }
    }
  | { accepted: false; reason: RelayCanvasRejection }

/**
 * 「观看者 + 步骤」→ 该观看者本棒负责的链下标（S9 的环状顺延唯一落点）。
 * 链 j 的第 s 棒动手者是链 (j + s - 1) 的发起人，因此观看者本棒的链＝以他为发起人的链向前回退 (s - 1) 条。
 * 视图裁剪（`relay-snapshot`）与绘图目标解析共用本函数，避免同一套环形算式在两处漂移。
 */
export function relayChainIndexOf(
  chainCount: number,
  viewerIndex: number,
  step: RelayStep,
): number {
  return (viewerIndex - (step - 1) + chainCount) % chainCount
}

/** 解析「观看者 + 步骤 id」对应的本棒链画布；拒绝时只返回领域原因。 */
export function resolveRelayCanvasTarget(
  source: RelayCanvasSource,
  playerId: string,
  stepId: string,
): RelayCanvasDecision {
  const { relay } = source
  // 顺序即优先级：旧包（客户端状态落后）最先，其次是非作画棒，最后才是越权。
  if (stepId !== relay.stepId) return { accepted: false, reason: 'stale-step' }
  const step = relay.currentStep
  if (source.phase !== 'relay_draw' || !isDrawingStep(step))
    return { accepted: false, reason: 'not-drawing-step' }
  const originIndex = relay.chains.findIndex((chain) => chain.originPlayerId === playerId)
  if (originIndex < 0) return { accepted: false, reason: 'not-participant' }
  if (relay.stepSubmissions.has(playerId)) return { accepted: false, reason: 'already-submitted' }
  const chainCount = relay.chains.length
  const chain = relay.chains[relayChainIndexOf(chainCount, originIndex, step)]
  if (!chain) return { accepted: false, reason: 'not-participant' }
  // 步 1 写第一幅画布、步 3 写第二幅：两幅各自独立计数（S45）。
  return {
    accepted: true,
    value: {
      step,
      chain,
      canvas: step === 1 ? chain.step1Canvas : chain.step3Canvas,
    },
  }
}
