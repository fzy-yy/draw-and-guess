/**
 * 接龙步骤事实（纯函数，S9）。
 *
 * 一条链固定四步：步 1/3 作画、步 2/4 猜词。步骤角色决定「接龙绘图事件写进哪幅画布」
 * （步 1 → 第一幅，步 3 → 第二幅）与步骤推进时的换手对象，工单 05/06 的状态机复用本模块；
 * 协议侧只有步骤数（`RELAY_STEP_COUNT`），步骤角色不在线上暴露，故落点是服务端领域
 * （与 `domain/room/phase-facts.ts` 的阶段白名单同一手法）。
 */
import type { RelayStep } from '@draw-guess/shared'

/** 作画步骤：步 1 产出第一幅画，步 3 产出第二幅画。 */
export const RELAY_DRAWING_STEPS = [1, 3] as const satisfies readonly RelayStep[]

/** 猜词步骤：步 2 猜第一幅画、步 4 猜第二幅画（提交内容写回本链产出）。 */
export const RELAY_GUESSING_STEPS = [2, 4] as const satisfies readonly RelayStep[]

/** 作画步骤号：比 `RelayStep` 更窄，供「步骤 → 画布」的映射做穷尽判定。 */
export type RelayDrawingStep = (typeof RELAY_DRAWING_STEPS)[number]

/** 猜词步骤号：比 `RelayStep` 更窄，供提交 / 超时推进按步骤类型分流。 */
export type RelayGuessingStep = (typeof RELAY_GUESSING_STEPS)[number]

/** 该步骤是否由玩家作画（否则为猜词棒）；类型谓词让调用方拿到窄化后的作画步骤号。 */
export function isDrawingStep(step: RelayStep): step is RelayDrawingStep {
  return RELAY_DRAWING_STEPS.some((candidate) => candidate === step)
}
