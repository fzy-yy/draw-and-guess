import { APP_CONFIG } from '@draw-guess/config'
import type { PlaySoundOptions, SoundName } from './types.ts'
import type { AudioFactory, AudioPort, AudioUnlockProvider, SoundClock } from './contracts.ts'
import { calculateEffectiveVolume, type AudioSettingsState } from './volume.ts'

/** SoundManager 的运行依赖；全部由外部注入，管理器本身不触碰全局 Audio/Date。 */
export interface SoundManagerOptions {
  /** 创建单个播放器（浏览器适配器用 new Audio，测试用假工厂）。 */
  audioFactory: AudioFactory
  /** 时钟（生产用 Date.now，测试用假时钟）。 */
  clock: SoundClock
  /** 解析音效键到静态资源 URL（复用 manifest；缺失返回 undefined 即安全降级）。 */
  getSoundUrl: (name: SoundName | string) => string | undefined
  /** 应用级解锁通知：BGM 首次被 Autoplay 拦截后，在首次用户手势时重试。 */
  unlock?: AudioUnlockProvider
  /** 初始音量/静音设置；缺省用本地默认。 */
  settings?: AudioSettingsState
}

/**
 * 纯 HTML5 Audio 发音与背景音乐管理器（不依赖全局 Audio 与 Date.now()）。
 * 负责音频实例池复用、BGM 循环、防刷冷却、动态音量折算、Autoplay 安全防护与销毁。
 *
 * BGM 期望状态：playBgm 记录「期望的 BGM」。若首次 play() 因浏览器 Autoplay 被拦截，
 * 不静默丢弃意图，而是在首个用户手势/适配器解锁通知后仅重试「当前期望 BGM」。
 *
 * BGM 音量切换为即时设置（不实现渐隐/渐入，避免引入定时器残留）；对 BGM 的任何异步播放
 * 结果都经「代数」守卫：被更新的请求取代的旧结果会被取消，因而不会产生并发残留。
 */
export class SoundManager {
  /** 短音效实例池：soundName -> AudioPort[]。 */
  private sfxPool = new Map<SoundName, AudioPort[]>()

  /** SFX 池满时的轮转游标（soundName -> 下一个复用的下标），保证可预测、不固定复用首个实例。 */
  private sfxPoolCursor = new Map<SoundName, number>()

  /** 记录每个 SFX 实例最近一次播放用到的音量缩放（volumeScale），供设置变化时重算音量。 */
  private sfxScale = new Map<AudioPort, number>()

  /** 各音效最近一次可听触发时间戳（用于冷却限频）。 */
  private lastTriggerTime = new Map<string, number>()

  /** 当前正在播放（或待解锁恢复）的背景音乐实例。 */
  private currentBgmPort: AudioPort | null = null

  /** 当前背景音乐名称。 */
  private currentBgmName: SoundName | null = null

  /** 期望播放的背景音乐名称（最新的 BGM 意图；stop 时清空）。 */
  private expectedBgm: SoundName | null = null

  /** BGM 播放请求代数：每次发起/重试 BGM 播放递增，用于作废「过期播放请求」。 */
  private bgmGeneration = 0

  /** 当前 BGM 是否仍在等待解锁（首次 play 被 Autoplay 拦截）。 */
  private bgmAwaitingUnlock = false

  /** 当前音效管理器的声音设置状态。 */
  private settings: AudioSettingsState

  private readonly audioFactory: AudioFactory
  private readonly clock: SoundClock
  private readonly getSoundUrl: (name: SoundName | string) => string | undefined
  private readonly unsubscribeUnlock: (() => void) | null

  constructor(options: SoundManagerOptions) {
    this.audioFactory = options.audioFactory
    this.clock = options.clock
    this.getSoundUrl = options.getSoundUrl
    this.settings = options.settings ?? {
      masterVolume: APP_CONFIG.localSettings.masterVolume,
      soundVolume: APP_CONFIG.localSettings.soundVolume,
      musicVolume: APP_CONFIG.localSettings.musicVolume,
      muted: APP_CONFIG.localSettings.muted,
    }

    // 订阅解锁通知：BGM 被 Autoplay 拦截后，在首次用户手势时重试「当前期望 BGM」。
    this.unsubscribeUnlock = options.unlock?.subscribeUnlock(this.onUnlock) ?? null
  }

  /** 更新本地音量与静音偏好设置，并同步当前播放中的 BGM 与仍活跃的 SFX 音量。 */
  public updateSettings(newSettings: Partial<AudioSettingsState>): void {
    this.settings = { ...this.settings, ...newSettings }
    this.syncBgmVolume()
    this.syncActiveSfxVolumes()
  }

  /** 获取当前音频管理器持有的设置副本。 */
  public getSettings(): AudioSettingsState {
    return this.settings
  }

  /**
   * 折算最终有效播放音量（0~1）。
   * 若用户开启静音或音量为 0，返回 0；否则综合 主音量 * 对应总线音量 * 音效特定微调倍率。
   */
  public calculateVolume(
    channel: 'sfx' | 'bgm',
    volumeMultiplier = 1.0,
    volumeScale = 1.0,
  ): number {
    return calculateEffectiveVolume(this.settings, channel, volumeMultiplier, volumeScale)
  }

  /**
   * 播放指定短音效。
   * 自动检查冷却防刷、发音池复用、音量折算；静音时不触发、不写冷却；
   * 资源缺失或浏览器 Autoplay 拦截时静默降级（短音效不做解锁重试，仅 BGM 重试）。
   */
  public play(name: SoundName, options?: PlaySoundOptions): void {
    const meta = APP_CONFIG.audio.sounds[name]
    if (!meta) return

    // 如果该音频本身被标记为 BGM，转交由 playBgm 处理
    if (meta.isBgm) {
      this.playBgm(name)
      return
    }

    // 冷却防刷检查（可听触发前不判失败）；从未触发过则立即允许，避免时钟从 0 起算时误抑制
    const now = this.clock.now()
    const lastTime = this.lastTriggerTime.get(name)
    if (lastTime !== undefined && now - lastTime < meta.cooldownMs) return

    const url = this.getSoundUrl(name)
    if (!url) return

    const targetVolume = this.calculateVolume('sfx', meta.volumeMultiplier, options?.volumeScale)
    // 静音或音量为 0：真正听不到，既不触发播放也不写冷却
    if (targetVolume <= 0) return

    // 只有确实要开始可听播放后才写冷却（避免静音触发吞掉非静音时的提示音）
    this.lastTriggerTime.set(name, now)

    const port = this.acquireSfxPort(name, url, options?.volumeScale)
    port.volume = targetVolume
    // 短音效为一次性触发，Autoplay 被拦截时静默忽略（不做解锁重试）
    void port
      .play()
      .then(() => {})
      .catch(() => {})
  }

  /**
   * 从 SFX 池取一个可复用实例：优先复用空闲实例，池满时按配置策略（round-robin）轮转复用，
   * 避免固定命中数组首个实例。返回一个已重置 currentTime 并记录音量缩放的可用端口。
   */
  private acquireSfxPort(name: SoundName, url: string, volumeScale?: number): AudioPort {
    const { maxInstances, preemptStrategy } = APP_CONFIG.audio.sfxPool

    let pool = this.sfxPool.get(name)
    if (!pool) {
      pool = []
      this.sfxPool.set(name, pool)
    }

    // 优先找空闲实例（暂停或播放完毕）
    let port = pool.find((item) => item.paused || item.ended)

    // 池满且无空闲：按配置策略抢占。round-robin 用游标轮转，游标只在复用后推进。
    if (!port && pool.length > 0 && pool.length >= maxInstances) {
      switch (preemptStrategy) {
        case 'round-robin': {
          const cursor = this.sfxPoolCursor.get(name) ?? 0
          const index = cursor % pool.length
          const reusable = pool[index]
          if (reusable) {
            port = reusable
            this.sfxPoolCursor.set(name, index + 1)
          }
          break
        }
        default: {
          // preemptStrategy 已收敛为单一字面量，此分支仅为未来新增策略提供编译期遗漏提示
          const exhaustive: never = preemptStrategy
          return exhaustive
        }
      }
    }

    if (!port && pool.length < maxInstances) {
      port = this.audioFactory.create(url)
      port.preload = 'auto'
      pool.push(port)
    }

    // 兜底（maxInstances 为 0 或退化场景）：直接新建，不入池，避免越界
    if (!port) {
      port = this.audioFactory.create(url)
      port.preload = 'auto'
    }

    port.currentTime = 0
    this.sfxScale.set(port, volumeScale ?? 1.0)
    return port
  }

  /**
   * 播放指定的循环背景音乐（BGM）。
   * 目标 BGM 资源缺失时保留当前音乐（不先停旧 BGM）；首次 play 被 Autoplay 拦截时保存期望，
   * 待解锁后仅重试「当前期望 BGM」。
   */
  public playBgm(name: SoundName): void {
    const meta = APP_CONFIG.audio.sounds[name]
    const url = this.getSoundUrl(name)

    // 目标 BGM 资源缺失：不切换、也不打断当前播放的音乐（保留旧音乐）
    if (!url) return

    // 期望背景音乐 = 本次请求的目标
    this.expectedBgm = name

    // 正在播放同一首：仅平滑同步音量；若上次被 Autoplay 拦截而暂停，则重新发起播放
    if (this.currentBgmName === name && this.currentBgmPort) {
      this.syncBgmVolume()
      if (this.currentBgmPort.paused) {
        this.requestBgmPlay(this.currentBgmPort)
      }
      return
    }

    // 切歌：先验证目标可用（上方已校验），再停止旧 BGM 并创建新实例
    this.teardownBgm()
    this.expectedBgm = name
    this.installBgmPort(name, url, meta?.volumeMultiplier ?? 1.0)
  }

  /**
   * 解锁（浏览器首次用户手势）通知：仅在当前期望 BGM 尚未真正播放时重试它，
   * 其它背景音乐与被拦截的短音效一律不重试。
   */
  private readonly onUnlock = (): void => {
    const desired = this.expectedBgm
    if (!desired) return
    const url = this.getSoundUrl(desired)
    if (!url) return

    this.syncBgmVolume()

    // 期望的就是当前活动 BGM：若仍在等待解锁（被拦截），则恢复播放
    if (this.currentBgmName === desired && this.currentBgmPort) {
      if (this.bgmAwaitingUnlock || this.currentBgmPort.paused) {
        this.requestBgmPlay(this.currentBgmPort)
      }
      return
    }

    // 期望 BGM 与当前活动 BGM 不一致（切换后被拦截）：按期望重建（重试「当前期望 BGM」）
    this.teardownBgm()
    this.expectedBgm = desired
    const meta = APP_CONFIG.audio.sounds[desired]
    this.installBgmPort(desired, url, meta?.volumeMultiplier ?? 1.0)
  }

  /** 停止当前正在播放的背景音乐，并清除「期望 BGM」（表示不再期望任何 BGM）。 */
  public stopBgm(): void {
    this.teardownBgm()
    this.expectedBgm = null
  }

  /** 停止并释放当前 BGM 实例，清空活动状态（保留 expectedBgm，供切歌/解锁重建时由调用方设置）。 */
  private teardownBgm(): void {
    // 递增代数，作废任何仍在进行的 BGM 播放异步结果（避免释放后旧结果误设解锁状态）。
    this.bgmGeneration += 1
    const port = this.currentBgmPort
    if (port) {
      port.pause()
      port.currentTime = 0
      port.dispose() // 释放 src，避免切歌/停止时旧实例残留（见缺陷报告 #12）
    }
    this.currentBgmPort = null
    this.currentBgmName = null
    this.bgmAwaitingUnlock = false
  }

  /** 创建并安装一个新的 BGM 实例，然后发起播放。 */
  private installBgmPort(name: SoundName, url: string, volumeMultiplier: number): void {
    const port = this.audioFactory.create(url)
    port.loop = true
    port.preload = 'auto'
    port.volume = this.calculateVolume('bgm', volumeMultiplier)
    this.currentBgmPort = port
    this.currentBgmName = name
    this.requestBgmPlay(port)
  }

  /**
   * 发起一次 BGM 播放，并记下代数；异步结果若已被更新的请求取代则视为「过期播放请求」被取消。
   * 只有最新代数的结果才会被采纳（用于标记是否仍在等待解锁）。
   */
  private requestBgmPlay(port: AudioPort): void {
    const generation = ++this.bgmGeneration
    void port
      .play()
      .then((result) => {
        if (generation !== this.bgmGeneration) return // 过期请求：被更新的 BGM 请求取代，忽略
        this.bgmAwaitingUnlock = result === 'blocked'
      })
      .catch(() => {})
  }

  /** 当用户调整音量滑块或切换静音时，实时同步正在播放的 BGM 音量。 */
  public syncBgmVolume(): void {
    if (!this.currentBgmPort || !this.currentBgmName) return
    const meta = APP_CONFIG.audio.sounds[this.currentBgmName]
    this.currentBgmPort.volume = this.calculateVolume('bgm', meta?.volumeMultiplier ?? 1.0)
  }

  /** 设置变化时同步仍活跃（非暂停）的 SFX 音量，使其立即反映新的音量/静音偏好。 */
  private syncActiveSfxVolumes(): void {
    for (const [name, pool] of this.sfxPool) {
      const meta = APP_CONFIG.audio.sounds[name]
      if (!meta) continue
      for (const port of pool) {
        if (port.paused) continue // 已暂停的实例下次播放会重新设音量，无需同步
        port.volume = this.calculateVolume(
          'sfx',
          meta.volumeMultiplier,
          this.sfxScale.get(port) ?? 1.0,
        )
      }
    }
  }

  /** 停止所有音效与背景音乐（用于组件卸载或注销；保留池以复用，不销毁实例）。 */
  public stopAll(): void {
    this.stopBgm()
    for (const pool of this.sfxPool.values()) {
      for (const port of pool) {
        port.pause()
        port.currentTime = 0
      }
    }
  }

  /**
   * 彻底销毁：暂停并释放所有实例（含 BGM 与发音池）、清理状态与冷却记录、取消解锁订阅。
   * 全局单例长生命周期不调用，仅在被替换或应用级注销时使用。
   */
  public dispose(): void {
    this.unsubscribeUnlock?.()
    // stopBgm → teardownBgm 会 pause+dispose 当前 BGM 实例（含清空 src），无需再单独释放。
    this.stopBgm()
    for (const pool of this.sfxPool.values()) {
      for (const port of pool) port.dispose()
    }
    // 清空池、轮转游标、音量缩放与冷却记录；期望 BGM 已由 stopBgm 置空
    this.sfxPool.clear()
    this.sfxPoolCursor.clear()
    this.sfxScale.clear()
    this.lastTriggerTime.clear()
  }
}
