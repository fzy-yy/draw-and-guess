/**
 * 原型上下文：PrototypeApp 装配一次（真实 HUD 派生值 + 本地画板历史 + 全屏等动作），
 * 三个变体经 inject 取用——它们渲染的是同一局模拟对局，避免每个变体重复一长串 props。
 */
import { inject, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type {
  DrawingCommand,
  FillCommand,
  GameView,
  Stroke,
  StrokeAck,
  ToolKind,
} from '@draw-guess/shared'
import type { FillAck } from '@/composables/useFillSession'
import type { RequestResult } from '@/stores/request'

export interface PrototypeGameContext {
  /** HUD 派生值（useGameHud，全舞台唯一 ticker）。 */
  game: ComputedRef<GameView | undefined>
  secondsLeft: ComputedRef<number>
  progress: ComputedRef<number>
  canGuess: ComputedRef<boolean>
  /** 画板工具状态（变体通过 v-model 绑定到工具栏与画布）。 */
  tool: Ref<ToolKind>
  color: Ref<string>
  width: Ref<number>
  /** 本地画板历史（无后端，见 prototype-drawing.ts）。 */
  commands: Ref<DrawingCommand[]>
  undoneIds: Ref<string[]>
  revision: Ref<number>
  lastSequence: Ref<number>
  isFullscreen: Ref<boolean>
  submitStroke: (stroke: Stroke, onResult: (result: RequestResult<StrokeAck>) => void) => void
  submitFill: (fill: FillCommand, onResult: (result: RequestResult<FillAck>) => void) => void
  onToggleFullscreen: () => void
  onOpenSettings: () => void
}

export const PROTOTYPE_GAME_KEY: InjectionKey<PrototypeGameContext> = Symbol('prototype-game')

export function usePrototypeContext(): PrototypeGameContext {
  const context = inject(PROTOTYPE_GAME_KEY)
  if (!context) throw new Error('PrototypeGameContext 未注入：变体必须渲染在 PrototypeApp 内')
  return context
}
