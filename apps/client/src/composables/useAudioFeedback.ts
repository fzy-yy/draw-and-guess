/**
 * 全局对局事件音效挂载钩子。
 * 只订阅领域状态并交给 routing.ts 的语义映射决策；音量折算 / 资源可用性 /
 * Autoplay 静默降级由 SoundManager 负责。本文件不参与任何服务端游戏裁决。
 * （背景音乐编排已随 BGM 系统移除，阶段切换只保留入场提示音。）
 */
import { onBeforeUnmount, watch } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import type { RoomPhase } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import { playSound, soundManager } from '@/audio'
import { eventToAudio, phaseToAudio, type AudioDecision } from '@/audio/routing'
import type { SoundName } from '@/audio'

export function useAudioFeedback(): void {
  const store = useGameStore()
  let lastWarningSecond = -1

  /** 应用一次性 SFX。 */
  function applySfx(sfx?: SoundName): void {
    if (sfx) playSound(sfx)
  }

  /** 按阶段应用决策：进入新阶段时播放入场 SFX。 */
  function applyPhase(phase: RoomPhase): void {
    applySfx(phaseToAudio(phase).sfx)
  }

  /** 应用一次领域事件决策。 */
  function applyDecision(decision: AudioDecision): void {
    applySfx(decision.sfx)
  }

  // 房间阶段变化：进入时播放入场 SFX；进入作画时复位「末位秒数」
  watch(
    () => store.room?.phase,
    (phase, previous) => {
      if (!phase || phase === previous) return
      applyPhase(phase)
      if (phase === 'drawing') lastWarningSecond = -1
    },
  )

  soundManager.updateSettings(store.settings)

  // 音量/静音变化：同步播放器设置，使正在播放的短音效实例立即反映新音量
  watch(
    () => [store.settings.muted, store.settings.masterVolume, store.settings.soundVolume],
    () => {
      soundManager.updateSettings(store.settings)
    },
  )

  // 离房：room 由存在变为空 → 播放离场音
  watch(
    () => Boolean(store.room),
    (hasRoom, previous) => {
      if (previous && !hasRoom) applyDecision(eventToAudio('room-leave'))
    },
  )

  // 断线恢复：由「断开 → 连接」时且带 room，播放恢复提示音
  watch(
    () => store.connected,
    (connected, previous) => {
      // 仅在从断开恢复为连接时处理；首次连接（无 room）由下方阶段守卫自然跳过
      if (!connected || previous !== false) return
      if (!store.room?.phase) return
      applyDecision(eventToAudio('session-restore'))
    },
  )

  // 自己准备/猜中/收到邀请时播放对应音效
  watch(
    () => store.me?.ready,
    (ready) => ready && applyDecision(eventToAudio('self-ready')),
  )
  watch(
    () => store.me?.guessed,
    (guessed) => guessed && applyDecision(eventToAudio('self-guessed')),
  )
  watch(
    () => store.invites.length,
    (count, previous) => count > previous && applyDecision(eventToAudio('invite')),
  )

  // 最后十秒按服务端结束时间与全局时钟偏移计算倒计时滴答警报
  const warningTimer = window.setInterval(() => {
    const endsAt = store.room?.game?.phaseEndsAt
    if (!endsAt || store.room?.phase !== 'drawing') return
    const second = Math.ceil((endsAt - (Date.now() + store.clockOffset)) / 1_000)
    if (second > 0 && second <= APP_CONFIG.game.warningSeconds && second !== lastWarningSecond) {
      lastWarningSecond = second
      applyDecision(eventToAudio('countdown-tick'))
    }
  }, store.config.ui.tickIntervalMs)

  // 组件卸载时清理定时器并停止全部发音
  onBeforeUnmount(() => {
    window.clearInterval(warningTimer)
    soundManager.stopAll()
  })
}
