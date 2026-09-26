/**
 * 房间阶段文案的统一映射（与 `role-text.ts` 同族）。
 *
 * HUD 阶段标签（`useGameHud`）与阶段遮罩的无障碍播报（`PhaseOverlay`）曾各写一份
 * 逐字相同的 `Record<RoomPhase, string>`；集中后两处展示/播报口径一致。
 * 文案全部来自 @draw-guess/strings（见 docs/adr/0028-client-room-facts.md）。
 */
import { strings } from '@draw-guess/strings'
import type { RoomPhase } from '@draw-guess/shared'

const PHASE_TEXT: Record<RoomPhase, string> = {
  starting: strings.status.phaseStarting,
  choosing_word: strings.status.phaseChoosing,
  drawing: strings.status.phaseDrawing,
  round_result: strings.status.phaseRoundResult,
  paused: strings.status.phasePaused,
  game_result: strings.status.phaseGameResult,
  waiting: strings.status.phaseWaiting,
  closed: strings.status.phaseClosed,
}

/** 阶段文案；缺省阶段按 waiting 展示（与服务端快照缺省一致）。 */
export function phaseTextFor(phase: RoomPhase | undefined): string {
  return PHASE_TEXT[phase ?? 'waiting']
}
