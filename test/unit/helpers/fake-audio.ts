import type {
  AudioFactory,
  AudioPort,
  AudioPreload,
  SoundClock,
} from '../../../apps/client/src/audio/contracts.ts'

/**
 * 音效管理器的假实现：不触碰浏览器 Audio / document，供 unit 测试注入。
 * FakeAudioPort 记录 play/pause 调用，并模拟真实元素的 paused 状态迁移。
 * （BGM 与 Autoplay 解锁重试已移除，不再需要可配置的播放结果与延迟委托；
 * 端口契约亦不再暴露 url（只写不读）与 dispose（全仓无注销销毁调用链）。）
 */

/** 假播放器：记录调用次数与状态，供断言。 */
export class FakeAudioPort implements AudioPort {
  paused = true
  ended = false
  volume = 0
  preload: AudioPreload = ''
  currentTime = 0

  /** play() 被调用次数。 */
  playCalls = 0

  play(): void {
    this.playCalls += 1
    // 模拟真实元素：play 成功则不再视为暂停
    this.paused = false
  }

  pause(): void {
    this.paused = true
  }
}

export class FakeAudioFactory implements AudioFactory {
  readonly created: FakeAudioPort[] = []

  /** url 入参刻意忽略：端口契约不再暴露 url，测试侧也无需断言资源地址。 */
  create(): FakeAudioPort {
    const port = new FakeAudioPort()
    this.created.push(port)
    return port
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
