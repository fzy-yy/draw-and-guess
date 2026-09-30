/**
 * 音效系统统一出口（具名收窄）。
 * 只导出应用真实消费的六个符号——端口契约（AudioPort/AudioFactory）、清单、管理器类、
 * 音量纯函数等内部机制不进 app 级 interface；测试按子路径直连（如 audio/volume.ts），
 * useAudioFeedback 也从 @/audio/routing 子路径直连 phaseToAudio / eventToAudio 映射。
 * 通用组件优先调用 playInteractionSound() 表达交互语义；只有全局领域反馈
 * 才直接使用具体 SoundName，避免资源键散落在视图层。
 */
export type { SoundName } from './types.ts'
export { soundManager, playSound, playInteractionSound } from './browser-adapter.ts'
export type { InteractionAudioEvent } from './routing.ts'
export { initAudio } from './runtime.ts'
