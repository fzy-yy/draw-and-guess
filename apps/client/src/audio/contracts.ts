/**
 * 音效系统与外部的窄接口契约。
 *
 * SoundManager 不直接触碰全局 Audio/HTMLAudioElement 与 Date.now()，而是依赖这里的最小接口：
 * - AudioFactory：按需创建单个播放器（浏览器适配器用 new Audio 实现）。
 * - AudioPort：单个播放元素的窄化视图（管理器只依赖它，不感知 HTMLAudioElement）。
 * - SoundClock：时钟抽象（生产用 Date.now，测试用假时钟）。
 *
 * 背景音乐（BGM）系统已移除：契约只服务一次性短音效，播放失败（含浏览器 Autoplay
 * 拦截）由适配器内部静默吞掉，管理器不做解锁重试。
 */

/** HTMLMediaElement.preload 的合法取值（lib.dom 为窄联合，非 string）。 */
export type AudioPreload = '' | 'auto' | 'metadata' | 'none'

/** 单个播放元素的窄化接口（唯一直接接触 HTMLAudioElement 的是浏览器适配器）。 */
export interface AudioPort {
  readonly url: string
  /** 播放（fire-and-forget）；失败与 Autoplay 拦截在实现内部静默处理，不向上抛。 */
  play(): void
  pause(): void
  /** 是否已暂停。 */
  readonly paused: boolean
  /** 是否已播放完毕（用于短音效池复用）。 */
  readonly ended: boolean
  /** 音量（0~1）。 */
  volume: number
  /** 预加载策略。 */
  preload: AudioPreload
  /** 当前播放位置（秒），用于池满复用重置。 */
  currentTime: number
  /** 销毁：暂停并清空资源。 */
  dispose(): void
}

/** 工厂：由管理器在需要时创建新的播放器。 */
export interface AudioFactory {
  create(url: string): AudioPort
}

/** 时钟抽象，避免播放器直接依赖 Date.now()。 */
export interface SoundClock {
  now(): number
}
