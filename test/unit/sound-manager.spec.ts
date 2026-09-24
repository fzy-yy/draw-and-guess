import { describe, expect, it } from 'vitest'
import { SoundManager } from '../../apps/client/src/audio/manager.ts'
import type { AudioSettingsState } from '../../apps/client/src/audio/volume.ts'
import { FakeAudioFactory, FakeClock } from './helpers/fake-audio.ts'

/** 非静音、全音量基准设置，让播放必然产生可听实例。 */
const baseSettings: AudioSettingsState = {
  masterVolume: 1,
  soundVolume: 1,
  muted: false,
}

describe('SoundManager 假音频/假时钟', () => {
  it('保留的公开 API 呈契约：集中式 useAudioFeedback 依赖的方法均存在且可调用', () => {
    const manager = new SoundManager({
      audioFactory: new FakeAudioFactory(),
      clock: new FakeClock(),
      getSoundUrl: (name) => `/${name}.mp3`,
      settings: baseSettings,
    })
    // 收敛后的唯一音效调用面：playSound→play、stopAll、updateSettings（均被
    // useAudioFeedback/App 使用），以及作为运行依赖的查询与销毁入口。
    //（playBgm/stopBgm/syncBgmVolume 已随 BGM 系统移除。）
    for (const method of ['play', 'stopAll', 'updateSettings', 'getSettings', 'dispose'] as const) {
      expect(typeof (manager as unknown as Record<string, unknown>)[method]).toBe('function')
    }
  })

  it('发音池复用、受最大实例数限制，且冷却期内抑制重复触发', () => {
    const factory = new FakeAudioFactory()
    const clock = new FakeClock()
    const manager = new SoundManager({
      audioFactory: factory,
      clock,
      getSoundUrl: (name) => `/${name}.mp3`,
      settings: baseSettings,
    })

    // 冷却期内重复触发被抑制（click.cooldownMs = 50）
    manager.play('click')
    expect(factory.created.length).toBe(1)
    expect(factory.created[0]!.volume).toBe(1) // 1 * 1 * volumeMultiplier(1.0)
    manager.play('click')
    expect(factory.created.length).toBe(1)

    // 冷却过后再触发：全部实例仍在播放（paused=false），逐个新建直到池满(3)
    const playAfterCooldown = (): void => {
      clock.advance(60)
      manager.play('click')
    }
    playAfterCooldown()
    expect(factory.created.length).toBe(2)
    playAfterCooldown()
    expect(factory.created.length).toBe(3)
    playAfterCooldown()
    expect(factory.created.length).toBe(3) // 池满复用最早实例，不再新建
    expect(factory.created[0]!.currentTime).toBe(0) // 被复用实例重置时间
  })

  it('池满后按 round-robin 轮转复用实例，不会固定复用数组首个实例', () => {
    const factory = new FakeAudioFactory()
    const clock = new FakeClock()
    const manager = new SoundManager({
      audioFactory: factory,
      clock,
      getSoundUrl: (name) => `/${name}.mp3`,
      settings: baseSettings,
    })

    // 填满池（3 个实例）
    const playAfterCooldown = (): void => {
      clock.advance(60)
      manager.play('click')
    }
    manager.play('click')
    playAfterCooldown()
    playAfterCooldown()
    expect(factory.created.length).toBe(3)
    const p0 = factory.created[0]!
    const p1 = factory.created[1]!
    const p2 = factory.created[2]!
    expect([p0.playCalls, p1.playCalls, p2.playCalls]).toEqual([1, 1, 1])

    // 第 4、5、6、7 次分别复用 0、1、2、0 号实例（游标回绕），非固定 p0
    playAfterCooldown()
    expect([p0.playCalls, p1.playCalls, p2.playCalls]).toEqual([2, 1, 1])
    playAfterCooldown()
    expect([p0.playCalls, p1.playCalls, p2.playCalls]).toEqual([2, 2, 1])
    playAfterCooldown()
    expect([p0.playCalls, p1.playCalls, p2.playCalls]).toEqual([2, 2, 2])
    playAfterCooldown()
    expect([p0.playCalls, p1.playCalls, p2.playCalls]).toEqual([3, 2, 2])
    expect(factory.created.length).toBe(3) // 池不增长
  })

  it('零音量（音效通道为 0）不触发播放、不写冷却；调大后立即能播放', () => {
    const factory = new FakeAudioFactory()
    const manager = new SoundManager({
      audioFactory: factory,
      clock: new FakeClock(),
      getSoundUrl: (name) => `/${name}.mp3`,
      settings: { ...baseSettings, soundVolume: 0 },
    })

    manager.play('click')
    expect(factory.created.length).toBe(0) // 零音量 → 不创建实例

    // 零音量触发未占用冷却：调大后立即能播放
    manager.updateSettings({ soundVolume: 0.8 })
    manager.play('click')
    expect(factory.created.length).toBe(1)
  })

  it('设置变化同步仍活跃的 SFX 音量，静音会立即归零、取消静音恢复', () => {
    const factory = new FakeAudioFactory()
    const manager = new SoundManager({
      audioFactory: factory,
      clock: new FakeClock(),
      getSoundUrl: (name) => `/${name}.mp3`,
      settings: baseSettings,
    })

    manager.play('click')
    const port = factory.created[0]!
    expect(port.volume).toBe(1) // 1 * 1 * 1.0

    // 调整音效音量 → 活跃实例立即同步
    manager.updateSettings({ soundVolume: 0.5 })
    expect(port.volume).toBeCloseTo(0.5)

    // 静音 → 归零
    manager.updateSettings({ muted: true })
    expect(port.volume).toBe(0)

    // 取消静音 → 恢复到新音量
    manager.updateSettings({ muted: false })
    expect(port.volume).toBeCloseTo(0.5)
  })

  it('静音时不触发播放、不写冷却；取消静音后立即能播放', () => {
    const factory = new FakeAudioFactory()
    const clock = new FakeClock()
    const manager = new SoundManager({
      audioFactory: factory,
      clock,
      getSoundUrl: (name) => `/${name}.mp3`,
      settings: { ...baseSettings, muted: true },
    })

    manager.play('click')
    expect(factory.created.length).toBe(0) // 静音 → 不创建实例

    // 静音触发未写冷却：取消静音后立即能播放
    manager.updateSettings({ muted: false })
    manager.play('click')
    expect(factory.created.length).toBe(1)
  })

  it('资源缺失时安全降级：SFX 不播放、不抛错', () => {
    const factory = new FakeAudioFactory()
    const manager = new SoundManager({
      audioFactory: factory,
      clock: new FakeClock(),
      getSoundUrl: (name) => (name === 'click' ? `/${name}.mp3` : undefined),
      settings: baseSettings,
    })

    // SFX 缺失：不创建实例、不抛错
    expect(() => manager.play('switch')).not.toThrow()
    expect(factory.created.length).toBe(0)

    // 有资源的键正常播放
    manager.play('click')
    expect(factory.created.length).toBe(1)
  })

  it('stopAll 暂停并重置全部池内实例但不销毁；dispose 彻底释放', () => {
    const factory = new FakeAudioFactory()
    const manager = new SoundManager({
      audioFactory: factory,
      clock: new FakeClock(),
      getSoundUrl: (name) => `/${name}.mp3`,
      settings: baseSettings,
    })

    manager.play('click')
    const port = factory.created[0]!
    expect(port.paused).toBe(false)

    // stopAll：暂停但实例保留（池可复用）
    manager.stopAll()
    expect(port.paused).toBe(true)
    expect(port.disposed).toBe(false)

    // dispose：释放全部实例
    manager.dispose()
    expect(factory.created.every((createdPort) => createdPort.disposed)).toBe(true)
  })
})
