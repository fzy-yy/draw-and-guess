import type { AudioFactory, AudioPort, AudioPreload, SoundClock } from './contracts.ts'
import type { SoundName } from './types.ts'
import { SoundManager } from './manager.ts'
import { getSoundUrl } from './runtime.ts'
import { interactionToAudio, type InteractionAudioEvent } from './routing.ts'

/**
 * 浏览器适配器：唯一直接接触 HTMLAudioElement（全局 Audio）与 document 的位置。
 * 它把浏览器 API 代理成 contracts.ts 的窄接口，SoundManager 通过接口消费、不感知浏览器细节。
 *
 * 背景音乐与「首次手势解锁重试」已随 BGM 系统一并移除：短音效大多在用户手势内触发，
 * 极少数被 Autoplay 拦截的情况（如无人点击时的阶段音）在 play() 内静默吞掉即可。
 */

/** 单个 HTMLAudioElement 的窄化代理。 */
class BrowserAudioPort implements AudioPort {
  private readonly audio: HTMLAudioElement

  constructor(url: string) {
    this.audio = new Audio(url)
  }

  get paused(): boolean {
    return this.audio.paused
  }

  get ended(): boolean {
    return this.audio.ended
  }

  get volume(): number {
    return this.audio.volume
  }

  set volume(value: number) {
    this.audio.volume = value
  }

  get preload(): AudioPreload {
    return this.audio.preload
  }

  set preload(value: AudioPreload) {
    this.audio.preload = value
  }

  get currentTime(): number {
    return this.audio.currentTime
  }

  set currentTime(value: number) {
    this.audio.currentTime = value
  }

  play(): void {
    // fire-and-forget：Autoplay 拦截（NotAllowedError/AbortError）与其它播放失败
    // 都在此静默吞掉——短音效不做解锁重试，也绝不让 Promise 拒绝冒泡成未捕获异常。
    this.audio.play().catch(() => {})
  }

  pause(): void {
    this.audio.pause()
  }
}

/** 浏览器工厂：用 new Audio(url) 创建播放器（仅供下方单例装配，非公开 API）。 */
function createBrowserAudioFactory(): AudioFactory {
  return {
    create(url: string): AudioPort {
      return new BrowserAudioPort(url)
    },
  }
}

/** 浏览器时钟：直接使用 Date.now()（仅供下方单例装配，非公开 API）。 */
function createBrowserClock(): SoundClock {
  return { now: () => Date.now() }
}

/** 默认单例：浏览器 AudioFactory + Date 时钟 + 资源清单取 URL。 */
export const soundManager = new SoundManager({
  audioFactory: createBrowserAudioFactory(),
  clock: createBrowserClock(),
  getSoundUrl,
})

/** 便捷函数式发音接口：播放短音效。 */
export function playSound(name: SoundName): void {
  soundManager.play(name)
}

/**
 * 通用组件的统一交互反馈入口。
 * 调用方只表达“激活/选择/切换/打开/关闭”，具体资源由 routing.ts 集中映射。
 */
export function playInteractionSound(event: InteractionAudioEvent): void {
  // interactionToAudio 的返回类型是非空 SoundName 联合，恒可直接播放，无需再判空
  soundManager.play(interactionToAudio(event))
}
