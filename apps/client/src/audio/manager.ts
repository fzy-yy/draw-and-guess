import { APP_CONFIG } from '@draw-guess/config'
import type { SoundName } from './types.ts'
import type { AudioFactory, AudioPort, SoundClock } from './contracts.ts'
import { calculateEffectiveVolume, type AudioSettingsState } from './volume.ts'

/** SoundManager 的运行依赖；全部由外部注入，管理器本身不触碰全局 Audio/Date。 */
export interface SoundManagerOptions {
  /** 创建单个播放器（浏览器适配器用 new Audio，测试用假工厂）。 */
  audioFactory: AudioFactory
  /** 时钟（生产用 Date.now，测试用假时钟）。 */
  clock: SoundClock
  /** 解析音效键到静态资源 URL（复用 manifest；缺失返回 undefined 即安全降级）。 */
  getSoundUrl: (name: SoundName | string) => string | undefined
  /** 初始音量/静音设置；缺省用本地默认。 */
  settings?: AudioSettingsState
}

/**
 * 纯 HTML5 Audio 短音效管理器（不依赖全局 Audio 与 Date.now()）。
 * 负责音效实例池复用、防刷冷却与动态音量折算。
 *
 * 背景音乐（BGM）系统已整体移除：本管理器只处理一次性短音效；
 * 播放被浏览器 Autoplay 拦截或资源缺失时静默降级，不做解锁重试。
 */
export class SoundManager {
  /** 短音效实例池：soundName -> AudioPort[]。 */
  private sfxPool = new Map<SoundName, AudioPort[]>()

  /**
   * SFX 池满时的轮转游标（soundName -> 下一个复用的下标），保证可预测、不固定复用首个实例。
   * 不变量：池实例只增不减（无任何驱逐路径），游标对 pool.length 取模后永不移除、不会悬空；
   * 若未来为池引入实例驱逐（缩容），必须先重置对应键的游标，否则取模结果可能落在错误位置。
   */
  private sfxPoolCursor = new Map<SoundName, number>()

  /** 各音效最近一次可听触发时间戳（用于冷却限频）。 */
  private lastTriggerTime = new Map<string, number>()

  /** 当前音效管理器的声音设置状态。 */
  private settings: AudioSettingsState

  private readonly audioFactory: AudioFactory
  private readonly clock: SoundClock
  private readonly getSoundUrl: (name: SoundName | string) => string | undefined

  constructor(options: SoundManagerOptions) {
    this.audioFactory = options.audioFactory
    this.clock = options.clock
    this.getSoundUrl = options.getSoundUrl
    this.settings = options.settings ?? {
      masterVolume: APP_CONFIG.localSettings.masterVolume,
      soundVolume: APP_CONFIG.localSettings.soundVolume,
      muted: APP_CONFIG.localSettings.muted,
    }
  }

  /** 更新本地音量与静音偏好设置，并同步仍活跃的 SFX 音量。 */
  public updateSettings(newSettings: Partial<AudioSettingsState>): void {
    this.settings = { ...this.settings, ...newSettings }
    this.syncActiveSfxVolumes()
  }

  /**
   * 播放指定短音效。
   * 自动检查冷却防刷、发音池复用、音量折算；静音时不触发、不写冷却；
   * 资源缺失或浏览器 Autoplay 拦截时静默降级（短音效不做解锁重试）。
   */
  public play(name: SoundName): void {
    // SoundName 即 soundCatalog 的键（keyof 推导），已知键访问静态必然存在 meta，无需空值守卫
    const meta = APP_CONFIG.audio.sounds[name]

    // 冷却防刷检查（可听触发前不判失败）；从未触发过则立即允许，避免时钟从 0 起算时误抑制
    const now = this.clock.now()
    const lastTime = this.lastTriggerTime.get(name)
    if (lastTime !== undefined && now - lastTime < meta.cooldownMs) return

    const url = this.getSoundUrl(name)
    if (!url) return

    const targetVolume = calculateEffectiveVolume(this.settings, meta.volumeMultiplier)
    // 静音或音量为 0：真正听不到，既不触发播放也不写冷却
    if (targetVolume <= 0) return

    // 只有确实要开始可听播放后才写冷却（避免静音触发吞掉非静音时的提示音）
    this.lastTriggerTime.set(name, now)

    const port = this.acquireSfxPort(name, url)
    port.volume = targetVolume
    // 短音效为一次性触发，Autoplay 被拦截时静默忽略（适配器内部吞掉失败）
    port.play()
  }

  /**
   * 从 SFX 池取一个可复用实例：优先复用空闲实例，池满时按配置策略（round-robin）轮转复用，
   * 避免固定命中数组首个实例。返回一个已重置 currentTime 的可用端口。
   */
  private acquireSfxPort(name: SoundName, url: string): AudioPort {
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
    return port
  }

  /** 设置变化时同步仍活跃（非暂停）的 SFX 音量，使其立即反映新的音量/静音偏好。 */
  private syncActiveSfxVolumes(): void {
    for (const [name, pool] of this.sfxPool) {
      // 同上：池键由 SoundName 写入，已知键访问静态必然存在 meta
      const meta = APP_CONFIG.audio.sounds[name]
      for (const port of pool) {
        if (port.paused) continue // 已暂停的实例下次播放会重新设音量，无需同步
        port.volume = calculateEffectiveVolume(this.settings, meta.volumeMultiplier)
      }
    }
  }

  /** 停止所有音效（用于组件卸载；保留池实例以便复用，暂停的音量在下次播放时重设）。 */
  public stopAll(): void {
    for (const pool of this.sfxPool.values()) {
      for (const port of pool) {
        port.pause()
        port.currentTime = 0
      }
    }
  }
}
