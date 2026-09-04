/**
 * 轻量事件音效组合式函数。
 * 使用 Web Audio 合成极短提示音，不依赖远程资源；只有用户首次指针/键盘交互后才创建音频上下文，
 * 因而遵守浏览器自动播放限制。静音和音量实时读取本地设置。
 */
import { onBeforeUnmount, watch } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import { useGameStore } from '@/stores/game'

type CueName = keyof typeof APP_CONFIG.audio.cues

/** 挂载全局声音监听；返回值无需暴露给组件，卸载时会统一释放 AudioContext。 */
export function useAudioFeedback(): void {
  const store = useGameStore()
  let context: AudioContext | undefined
  let lastWarningSecond = -1

  /** 首次用户交互时解锁音频上下文（遵守浏览器自动播放限制）。 */
  const unlock = (): void => {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
  }
  // 只用首次指针/键盘交互触发一次解锁
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })

  /** 播放指定提示音 cue：按频率序列合成短音，先静音/音量检查再发声。 */
  function play(name: CueName): void {
    const cue = store.config.audio.cues[name]
    // 静音且主/音效音量≤0 时不发声
    if (
      !cue ||
      !context ||
      store.settings.muted ||
      store.settings.masterVolume <= 0 ||
      store.settings.soundVolume <= 0
    )
      return
    const baseTime = context.currentTime
    // 为每个频率创建一个振荡器 + 增益包络，形成一拍短的提示音
    cue.frequencies.forEach((frequency, index) => {
      const oscillator = context?.createOscillator()
      const gain = context?.createGain()
      if (!oscillator || !gain || !context) return
      const start = baseTime + index * (cue.duration + 0.025)
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      // 快速淡入淡出避免爆音：从接近 0 指数爬升到目标音量再衰减回 0
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(
        Math.max(
          0.0001,
          store.settings.masterVolume *
            store.settings.soundVolume *
            store.config.audio.synthesizedGain,
        ),
        start + 0.012,
      )
      gain.gain.exponentialRampToValueAtTime(0.0001, start + cue.duration)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + cue.duration + 0.02)
    })
  }

  // 房间阶段变化时播放对应音效
  watch(
    () => store.room?.phase,
    (phase, previous) => {
      if (!phase || phase === previous) return
      // 新回合作画开始：复位「上次已响过的末位秒数」，否则新局最后一两秒的警告音
      // 会与上一局同秒数重合而被跳过（lastWarningSecond 是跨回合共享的变量）。
      if (phase === 'drawing') lastWarningSecond = -1
      if (phase === 'waiting') play('room')
      else if (phase === 'starting') play('starting')
      else if (phase === 'drawing') play('drawing')
      else if (phase === 'round_result') play('result')
      else if (phase === 'game_result') play('final')
    },
  )
  // 自己准备/猜中/收到邀请时播放对应音效
  watch(
    () => store.me?.ready,
    (ready) => ready && play('ready'),
  )
  watch(
    () => store.me?.guessed,
    (guessed) => guessed && play('correct'),
  )
  watch(
    () => store.invites.length,
    (count, previous) => count > previous && play('invite'),
  )

  // 最后十秒按服务端结束时间与全局时钟偏移重新计算：与 useGameHud 的倒计时同一口径，
  // 局域网设备时钟有偏差时警告音不会先于/后于 HUD 数字跳动；标签页恢复后也不会继续错误的本地值。
  // 轮询间隔取自 UI 配置（与 HUD 的 useTimestamp 同源），避免两处各写一个 200ms。
  const warningTimer = window.setInterval(() => {
    const endsAt = store.room?.game?.phaseEndsAt
    if (!endsAt || store.room?.phase !== 'drawing') return
    const second = Math.ceil((endsAt - (Date.now() + store.clockOffset)) / 1_000)
    if (second > 0 && second <= APP_CONFIG.game.warningSeconds && second !== lastWarningSecond) {
      lastWarningSecond = second
      play('warning')
    }
  }, store.config.ui.tickIntervalMs)

  // 组件卸载时清理定时器、事件监听与音频上下文
  onBeforeUnmount(() => {
    window.clearInterval(warningTimer)
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
    if (context) void context.close()
  })
}
