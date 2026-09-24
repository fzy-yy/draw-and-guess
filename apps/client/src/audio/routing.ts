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

/** 一次音频决策：进入阶段/发生事件时的一次性 SFX（可能无）。 */
export interface AudioDecision {
  /** 一次性音效（可能无）。 */
  sfx?: SoundName
}

/**
 * 房间阶段 → 音频决策：只保留入场 SFX。
 * starting/drawing/round_result/game_result 有入场音；
 * waiting/choosing_word/paused/closed 无入场音（返回空决策）。
 */
export function phaseToAudio(phase: RoomPhase): AudioDecision {
  switch (phase) {
    case 'waiting':
      return {}
    case 'starting':
      return { sfx: 'start' }
    case 'choosing_word':
      return {}
    case 'drawing':
      return { sfx: 'drawing' }
    case 'round_result':
      return { sfx: 'round_result' }
    case 'game_result':
      return { sfx: 'game_result' }
    case 'paused':
      return {}
    case 'closed':
      return {}
    default: {
      // RoomPhase 已全覆盖，此处仅为未来新增阶段提供编译期遗漏提示
      const exhaustive: never = phase
      return exhaustive
    }
  }
}

/** 领域事件 → 音频决策：全部是一次性 SFX。 */
export function eventToAudio(event: AudioEvent): AudioDecision {
  switch (event) {
    case 'self-ready':
      return { sfx: 'ready' }
    case 'self-guessed':
      return { sfx: 'correct' }
    case 'invite':
      return { sfx: 'invite' }
    case 'countdown-tick':
      return { sfx: 'tick' }
    case 'room-leave':
      return { sfx: 'close' }
    case 'session-restore':
      return { sfx: 'switch' }
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

/** 通用交互语义 → 音效决策；组件统一通过此映射接入，避免散落资源键。 */
export function interactionToAudio(event: InteractionAudioEvent): AudioDecision {
  switch (event) {
    case 'activate':
      return { sfx: 'click' }
    case 'select':
    case 'toggle':
      return { sfx: 'switch' }
    case 'open':
      return { sfx: 'popup' }
    case 'close':
      return { sfx: 'close' }
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}
