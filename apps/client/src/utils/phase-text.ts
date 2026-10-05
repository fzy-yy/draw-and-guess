/**
 * 房间阶段文案的统一映射（与 `role-text.ts` 同族）。
 *
 * HUD 阶段标签（`useGameHud`）与阶段遮罩的无障碍播报（`PhaseOverlay`）曾各写一份
 * 逐字相同的 `Record<RoomPhase, string>`；集中后两处展示/播报口径一致。
 * 文案全部来自 @draw-guess/strings（见 docs/adr/0028-client-room-facts.md）。
 */
import { strings } from '@draw-guess/strings'
import type { RelayPhase, RelayViewPhase, RoomPhase } from '@draw-guess/shared'

const PHASE_TEXT: Record<RoomPhase, string> = {
  starting: strings.ui.status.phaseStarting,
  choosing_word: strings.ui.status.phaseChoosing,
  drawing: strings.ui.status.phaseDrawing,
  round_result: strings.ui.status.phaseRoundResult,
  game_result: strings.ui.status.phaseGameResult,
  waiting: strings.ui.status.phaseWaiting,
  closed: strings.ui.status.phaseClosed,
  // 接龙阶段（S10）：映射完整由类型保证，新增接龙阶段漏登记即编译失败
  relay_choose: strings.ui.status.phaseRelayChoose,
  relay_draw: strings.ui.status.phaseRelayDraw,
  relay_guess: strings.ui.status.phaseRelayGuess,
  relay_showcase: strings.ui.status.phaseRelayShowcase,
  relay_vote: strings.ui.status.phaseRelayVote,
}

/** 阶段文案；缺省阶段按 waiting 展示（与服务端快照缺省一致）。 */
export function phaseTextFor(phase: RoomPhase | undefined): string {
  return PHASE_TEXT[phase ?? 'waiting']
}

/**
 * 接龙顶栏的阶段短名：顶栏的模式标签（「接龙」）已单独渲染，阶段全名再带一次「接龙」
 * 会读成「接龙 接龙作画」，故顶栏用短名。映射完整由类型保证，新增接龙阶段漏登记即编译失败。
 */
const RELAY_PILL_TEXT: Record<RelayPhase, string> = {
  relay_choose: strings.ui.game.relayPhaseChoose,
  relay_draw: strings.ui.game.relayPhaseDraw,
  relay_guess: strings.ui.game.relayPhaseGuess,
  relay_showcase: strings.ui.game.relayPhaseShowcase,
  relay_vote: strings.ui.game.relayPhaseVote,
}

/** 接龙顶栏的阶段短名；终局（`game_result`）与缺省回落经典阶段文案。 */
export function relayPillTextFor(phase: RelayViewPhase | undefined): string {
  if (!phase || phase === 'game_result') return phaseTextFor(phase)
  return RELAY_PILL_TEXT[phase]
}
