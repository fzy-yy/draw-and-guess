import type {
  AudioFactory,
  AudioPlayResult,
  AudioPort,
  AudioPreload,
  AudioUnlockProvider,
  SoundClock,
} from './contracts.ts'
import type { PlaySoundOptions, SoundName } from './types.ts'
import { SoundManager } from './manager.ts'
import { getSoundUrl } from './runtime.ts'
import { interactionToAudio, type InteractionAudioEvent } from './routing.ts'

/**
 * 浏览器适配器：唯一直接接触 HTMLAudioElement（全局 Audio）与 document 的位置。
 * 它把浏览器 API 代理成 contracts.ts 的窄接口，SoundManager 通过接口消费、不感知浏览器细节。
 */

/** 浏览器 Autoplay 拦截的 DOMException 名称（跨浏览器为 NotAllowedError / AbortError）。 */
const AUTOPLAY_BLOCK_NAMES = new Set(['NotAllowedError', 'AbortError'])

function isAutoplayBlocked(reason: unknown): boolean {
  const name = (reason as { name?: unknown } | null)?.name
  return typeof name === 'string' && AUTOPLAY_BLOCK_NAMES.has(name)
}

/** 单个 HTMLAudioElement 的窄化代理。 */
class BrowserAudioPort implements AudioPort {
  readonly url: string
  private readonly audio: HTMLAudioElement

  constructor(url: string) {
    this.url = url
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

  get loop(): boolean {
    return this.audio.loop
  }

  set loop(value: boolean) {
    this.audio.loop = value
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

  play(): Promise<AudioPlayResult> {
    // 把浏览器抛出的 Autoplay 拦截（AbortError / NotAllowedError）归一为 'blocked'，
    // 其它失败归一为 'failed'，让管理器能区分「待解锁恢复」与「不可重试的失败」。
    return this.audio.play().then(
      () => 'played',
      (reason: unknown) => (isAutoplayBlocked(reason) ? 'blocked' : 'failed'),
    )
  }

  pause(): void {
    this.audio.pause()
  }

  dispose(): void {
    this.audio.pause()
    this.audio.src = ''
    this.audio.load()
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

/** 浏览器解锁：首个 pointerdown / keydown / touchstart 视为首次用户手势，触发一次后即自动解除。
 * touchstart 用于无 Pointer Events 的老触屏（如旧 Safari），否则 BGM 可能永远不解锁（#13）。
 * 仅供下方单例装配使用，非公开 API。 */
function createBrowserUnlockProvider(target: Document = document): AudioUnlockProvider {
  return {
    subscribeUnlock(listener: () => void): () => void {
      const onUnlock = (): void => {
        target.removeEventListener('pointerdown', onUnlock)
        target.removeEventListener('keydown', onUnlock)
        target.removeEventListener('touchstart', onUnlock)
        listener()
      }
      target.addEventListener('pointerdown', onUnlock)
      target.addEventListener('keydown', onUnlock)
      target.addEventListener('touchstart', onUnlock)
      return () => {
        target.removeEventListener('pointerdown', onUnlock)
        target.removeEventListener('keydown', onUnlock)
        target.removeEventListener('touchstart', onUnlock)
      }
    },
  }
}

/** 默认单例：浏览器 AudioFactory + Date 时钟 + 文档首交互解锁 + 资源清单取 URL。 */
export const soundManager = new SoundManager({
  audioFactory: createBrowserAudioFactory(),
  clock: createBrowserClock(),
  unlock: createBrowserUnlockProvider(),
  getSoundUrl,
})

/** 便捷函数式发音接口：播放短音效。 */
export function playSound(name: SoundName, options?: PlaySoundOptions): void {
  soundManager.play(name, options)
}

/**
 * 通用组件的统一交互反馈入口。
 * 调用方只表达“激活/选择/切换/打开/关闭”，具体资源由 routing.ts 集中映射。
 */
export function playInteractionSound(
  event: InteractionAudioEvent,
  options?: PlaySoundOptions,
): void {
  const sound = interactionToAudio(event).sfx
  if (sound) soundManager.play(sound, options)
}

/** 便捷函数式发音接口：播放背景音乐。 */
export function playBgm(name: SoundName): void {
  soundManager.playBgm(name)
}

/** 便捷函数式发音接口：停止背景音乐。 */
export function stopBgm(): void {
  soundManager.stopBgm()
}
