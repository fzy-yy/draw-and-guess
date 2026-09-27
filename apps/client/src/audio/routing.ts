import type { RoomPhase } from '@draw-guess/shared'
import type { SoundName } from './types.ts'

/**
 * 音效路由：把「房间阶段 / 领域事件 / 交互语义」映射为「一次性 SFX」的唯一来源。
 *
 * 不在此处做任何游戏裁决：本模块只根据外部已裁决的 phase / 事件决定播什么音，
 * 客户端仍无法影响阶段、答案、分数等权威状态。useAudioFeedback 仅订阅领域状态，
 * 并把这里的决策交给 SoundManager 消费。
 *
 * 背景音乐（BGM）决策已随 BGM 系统移除：阶段切换只保留入场提示音。
 * 约定：两个 switch 的 default 分支为 `never`，用于在类型层面保证「映射完整」——
 * 新增阶段/事件而忘记处理时会直接编译报错。
 */

/** 领域事件（非房间阶段）→ 音效。 */
export type AudioEvent =
  'self-ready' | 'self-guessed' | 'invite' | 'countdown-tick' | 'room-leave' | 'session-restore'

/**
 * 通用组件只上报交互语义，不直接依赖具体音效资源名。
 * select 表示离散选项（导航、工具、单选等），toggle 表示布尔状态切换。
 */
export type InteractionAudioEvent = 'activate' | 'select' | 'toggle' | 'open' | 'close'

/**
 * 房间阶段 → 入场音效：只保留入场 SFX，无入场音的阶段返回 undefined。
 * starting/drawing/round_result/game_result 有入场音；
 * waiting/choosing_word/paused/closed 无入场音。
 */
export function phaseToAudio(phase: RoomPhase): SoundName | undefined {
  switch (phase) {
    case 'waiting':
      return undefined
    case 'starting':
      return 'start'
    case 'choosing_word':
      return undefined
    case 'drawing':
      return 'drawing'
    case 'round_result':
      return 'round_result'
    case 'game_result':
      return 'game_result'
    case 'paused':
      return undefined
    case 'closed':
      return undefined
    default: {
      // RoomPhase 已全覆盖，此处仅为未来新增阶段提供编译期遗漏提示
      const exhaustive: never = phase
      return exhaustive
    }
  }
}

/** 领域事件 → 音效：全部是一次性 SFX。 */
export function eventToAudio(event: AudioEvent): SoundName {
  switch (event) {
    case 'self-ready':
      return 'ready'
    case 'self-guessed':
      return 'correct'
    case 'invite':
      return 'invite'
    case 'countdown-tick':
      return 'tick'
    case 'room-leave':
      return 'close'
    case 'session-restore':
      return 'switch'
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

/** 通用交互语义 → 音效；组件统一通过此映射接入，避免散落资源键。 */
export function interactionToAudio(event: InteractionAudioEvent): SoundName {
  switch (event) {
    case 'activate':
      return 'click'
    case 'select':
    case 'toggle':
      return 'switch'
    case 'open':
      return 'popup'
    case 'close':
      return 'close'
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}
