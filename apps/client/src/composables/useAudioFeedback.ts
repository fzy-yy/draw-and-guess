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
  let timer = 0

  const unlock = (): void => {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })

  function play(name: CueName): void {
    const cue = store.config.audio.cues[name]
    if (
      !cue ||
      !context ||
      store.settings.muted ||
      store.settings.masterVolume <= 0 ||
      store.settings.soundVolume <= 0
    )
      return
    const baseTime = context.currentTime
    cue.frequencies.forEach((frequency, index) => {
      const oscillator = context?.createOscillator()
      const gain = context?.createGain()
      if (!oscillator || !gain || !context) return
      const start = baseTime + index * (cue.duration + 0.025)
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
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

  watch(
    () => store.room?.phase,
    (phase, previous) => {
      if (!phase || phase === previous) return
      if (phase === 'waiting') play('room')
      else if (phase === 'starting') play('starting')
      else if (phase === 'drawing') play('drawing')
      else if (phase === 'round_result') play('result')
      else if (phase === 'game_result') play('final')
    },
  )
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

  // 最后十秒按服务端结束时间重新计算；标签页恢复后不会继续错误的本地递减值。
  timer = window.setInterval(() => {
    const endsAt = store.room?.game?.phaseEndsAt
    if (!endsAt || store.room?.phase !== 'drawing') return
    const second = Math.ceil((endsAt - Date.now()) / 1_000)
    if (second > 0 && second <= 10 && second !== lastWarningSecond) {
      lastWarningSecond = second
      play('warning')
    }
  }, 200)

  onBeforeUnmount(() => {
    window.clearInterval(timer)
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
    if (context) void context.close()
  })
}
