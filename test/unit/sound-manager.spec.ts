import { describe, expect, it } from 'vitest'
import { SoundManager } from '../../apps/client/src/audio/manager.ts'
import type { AudioPlayResult } from '../../apps/client/src/audio/contracts.ts'
import type { AudioSettingsState } from '../../apps/client/src/audio/volume.ts'
import { FakeAudioFactory, FakeClock, FakeUnlockProvider } from './helpers/fake-audio.ts'

/** 非静音、全音量基准设置，让播放必然产生可听实例。 */
const baseSettings: AudioSettingsState = {
  masterVolume: 1,
  soundVolume: 1,
  musicVolume: 1,
  muted: false,
}

/** 让微任务（play() 的 .then）落地。 */
const flush = (): Promise<void> => Promise.resolve()

describe('SoundManager 假音频/假时钟', () => {
  it('保留的公开 API 呈契约：集中式 useAudioFeedback 依赖的方法均存在且可调用', () => {
    const manager = new SoundManager({
      audioFactory: new FakeAudioFactory(),
      clock: new FakeClock(),
      getSoundUrl: (name) => `/${name}.mp3`,
      settings: baseSettings,
    })
    // 收敛后的唯一音效调用面：playSound→play、playBgm、stopBgm、stopAll、updateSettings
    //（均被 useAudioFeedback/App 使用），以及作为运行依赖的查询与销毁入口。
    for (const method of [
      'play',
      'playBgm',
      'stopBgm',
      'stopAll',
      'updateSettings',
      'getSettings',
      'calculateVolume',
      'syncBgmVolume',
      'dispose',
    ] as const) {
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
    const clock = new FakeClock()
    const manager = new SoundManager({
      audioFactory: factory,
      clock,
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

  it('BGM 首次 play 被 Autoplay 拦截时保留期望，解锁后仅重试当前期望 BGM', async () => {
    const factory = new FakeAudioFactory()
    const unlock = new FakeUnlockProvider()
    factory.defaultPlayResult = 'blocked' // 模拟浏览器 Autoplay 拦截
    const manager = new SoundManager({
      audioFactory: factory,
      clock: new FakeClock(),
      getSoundUrl: (name) => `/${name}.mp3`,
      settings: baseSettings,
      unlock,
    })

    // 第一次请求 bgm_lobby 被拦截：意图保留，播放器仍处于暂停
    manager.playBgm('bgm_lobby')
    await flush()
    const lobby = factory.created[0]!
    expect(lobby.playCalls).toBe(1)
    expect(lobby.paused).toBe(true)

    // 再请求一个不同的 BGM（同样被拦截）
    manager.playBgm('bgm_game')
    await flush()
    const game = factory.created[1]!
    expect(game.playCalls).toBe(1)
    expect(game.paused).toBe(true)

    // 解锁：仅重试「当前期望 BGM」（bgm_game），不重试更早的 bgm_lobby
    game.playResult = 'played'
    unlock.fire()
    await flush()
    expect(game.playCalls).toBe(2)
    expect(game.paused).toBe(false)
    expect(lobby.playCalls).toBe(1) // bgm_lobby 未被重试
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

  it('资源缺失时安全降级：SFX 不播放，BGM 缺失不打断当前音乐', () => {
    const factory = new FakeAudioFactory()
    const manager = new SoundManager({
      audioFactory: factory,
      clock: new FakeClock(),
      getSoundUrl: (name) =>
        name === 'click' || name === 'bgm_lobby' ? `/${name}.mp3` : undefined,
      settings: baseSettings,
    })

    // SFX 缺失：不创建实例、不抛错
    expect(() => manager.play('switch')).not.toThrow()
    expect(factory.created.length).toBe(0)

    // 先播放一个有资源的大厅 BGM
    manager.playBgm('bgm_lobby')
    const lobby = factory.created[0]!
    expect(lobby.paused).toBe(false)

    // 请求缺失的 BGM：保留当前音乐，不停止、不创建
    manager.playBgm('bgm_game')
    expect(factory.created.length).toBe(1)
    expect(factory.created[0]).toBe(lobby)
    expect(lobby.paused).toBe(false)
  })

  it('取消过期播放请求：被取代的 BGM 异步结果不影响当前 BGM，解锁不误触已播放 BGM', async () => {
    const factory = new FakeAudioFactory()
    const unlock = new FakeUnlockProvider()
    let resolveLobby: (result: AudioPlayResult) => void = () => {}
    // 第一个创建的端口（bgm_lobby）使用「延迟完成」的委托，制造过期请求
    factory.enqueuePlayDelegate(
      () =>
        new Promise<AudioPlayResult>((resolve) => {
          resolveLobby = resolve
        }),
    )
    const manager = new SoundManager({
      audioFactory: factory,
      clock: new FakeClock(),
      getSoundUrl: (name) => `/${name}.mp3`,
      settings: baseSettings,
      unlock,
    })

    manager.playBgm('bgm_lobby')
    const lobby = factory.created[0]!
    expect(lobby.playCalls).toBe(1)

    // 切换到 bgm_game（立即成功），先前的请求被取代
    manager.playBgm('bgm_game')
    const game = factory.created[1]!
    await flush()
    expect(game.playCalls).toBe(1)
    expect(game.paused).toBe(false)

    // 旧请求此刻才完成（blocked）：应被代数守卫忽略，不标记为「等待解锁」
    resolveLobby('blocked')
    await flush()
    unlock.fire()
    await flush()
    // 当前期望=bgm_game 且已播放，不应被误重播；过期请求（bgm_lobby）也不被重试
    expect(game.playCalls).toBe(1)
    expect(lobby.playCalls).toBe(1)
  })

  it('销毁后释放所有实例、清空状态并取消解锁订阅', () => {
    const factory = new FakeAudioFactory()
    const unlock = new FakeUnlockProvider()
    const manager = new SoundManager({
      audioFactory: factory,
      clock: new FakeClock(),
      getSoundUrl: (name) => `/${name}.mp3`,
      settings: baseSettings,
      unlock,
    })

    manager.play('click') // SFX
    manager.playBgm('bgm_lobby') // BGM
    expect(factory.created.length).toBe(2)
    const playCalls = factory.created.map((port) => port.playCalls)

    manager.dispose()
    expect(factory.created.every((port) => port.disposed)).toBe(true)

    // 取消解锁订阅：此后 fire 不再触发任何播放
    unlock.fire()
    expect(factory.created.map((port) => port.playCalls)).toEqual(playCalls)
  })
})
