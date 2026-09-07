import type {
  AudioFactory,
  AudioPlayResult,
  AudioPort,
  AudioPreload,
  AudioUnlockProvider,
  SoundClock,
} from '../../../apps/client/src/audio/contracts.ts'

/**
 * 音效管理器的假实现：不触碰浏览器 Audio / document，供 unit 测试注入。
 * FakeAudioPort 可配置 play() 结果以模拟普通播放、Autoplay 拦截与恢复。
 */

/** 假播放器：记录调用并模拟播放结果。 */
export class FakeAudioPort implements AudioPort {
  readonly url: string
  paused = true
  ended = false
  volume = 0
  loop = false
  preload: AudioPreload = ''
  currentTime = 0
  disposed = false

  /** 下一次 play() 解析出的结果；可修改以模拟 Autoplay 拦截后恢复。 */
  playResult: AudioPlayResult = 'played'
  /** play() 被调用次数。 */
  playCalls = 0
  /** 可选的自定义 play 委托（用于制造「延迟完成」的过期请求）。 */
  private playDelegate: (() => Promise<AudioPlayResult>) | null = null

  constructor(url: string) {
    this.url = url
  }

  play(): Promise<AudioPlayResult> {
    this.playCalls += 1
    // 委托存在时完全交由委托控制（如延迟 resolve），否则按 playResult 模拟。
    if (this.playDelegate) return this.playDelegate()
    // 模拟真实元素：play 成功则不再视为暂停；被 Autoplay 拦截则保持暂停。
    if (this.playResult !== 'blocked') this.paused = false
    return Promise.resolve(this.playResult)
  }

  /** 设置自定义 play 委托（用于测试过期/延迟完成的播放请求）。 */
  setPlayDelegate(delegate: () => Promise<AudioPlayResult>): void {
    this.playDelegate = delegate
  }

  pause(): void {
    this.paused = true
  }

  dispose(): void {
    this.disposed = true
    this.paused = true
  }
}

export class FakeAudioFactory implements AudioFactory {
  readonly created: FakeAudioPort[] = []
  /** 新创建播放器的默认 play 结果（便于模拟整段被 Autoplay 拦截）。 */
  defaultPlayResult: AudioPlayResult = 'played'
  /** 按创建顺序入队的自定义 play 委托；未提供则用 defaultPlayResult。 */
  private readonly pendingDelegates: (() => Promise<AudioPlayResult>)[] = []

  create(url: string): AudioPort {
    const port = new FakeAudioPort(url)
    const delegate = this.pendingDelegates.shift()
    if (delegate) port.setPlayDelegate(delegate)
    else port.playResult = this.defaultPlayResult
    this.created.push(port)
    return port
  }

  /** 为下一次 create 入队一个自定义 play 委托（用于「延迟完成」的过期请求）。 */
  enqueuePlayDelegate(delegate: () => Promise<AudioPlayResult>): void {
    this.pendingDelegates.push(delegate)
  }
}

export class FakeClock implements SoundClock {
  time = 0
  now(): number {
    return this.time
  }
  advance(milliseconds: number): void {
    this.time += milliseconds
  }
}

export class FakeUnlockProvider implements AudioUnlockProvider {
  private listener: (() => void) | null = null

  subscribeUnlock(listener: () => void): () => void {
    this.listener = listener
    return () => {
      if (this.listener === listener) this.listener = null
    }
  }

  /** 触发解锁；已取消订阅则无行为。 */
  fire(): void {
    this.listener?.()
  }
}
