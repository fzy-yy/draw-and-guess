/**
 * 全局对局事件音效与背景音乐挂载钩子。
 * 只订阅领域状态并交给 routing.ts 的语义映射决策；BGM 决策 / 音量折算 / 资源可用性 /
 * Autoplay 重试由 SoundManager 负责。本文件不参与任何服务端游戏裁决。
 */
import { onBeforeUnmount, watch } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import type { RoomPhase } from '@draw-guess/shared'
import { useGameStore } from '@/stores/game'
import { playBgm, playSound, soundManager, stopBgm } from '@/audio'
import { eventToAudio, phaseToAudio, type AudioDecision } from '@/audio/routing'
import type { SoundName } from '@/audio'

export function useAudioFeedback(): void {
  const store = useGameStore()
  let lastWarningSecond = -1

  /** 应用一次性 SFX。 */
  function applySfx(sfx?: SoundName): void {
    if (sfx) playSound(sfx)
  }

  /** 应用期望 BGM；结合用户音量/静音偏好裁剪：听不到时一律停止 BGM。 */
  function applyBgm(bgm: SoundName | null | undefined): void {
    if (bgm === undefined) return
    const audible =
      !store.settings.muted && store.settings.masterVolume > 0 && store.settings.musicVolume > 0
    if (bgm === null || !audible) {
      stopBgm()
    } else {
      playBgm(bgm)
    }
  }

  /** 按阶段应用决策：进入新阶段时播放入场 SFX，并设置期望 BGM。 */
  function applyPhase(phase: RoomPhase, playEntrySfx: boolean): void {
    const decision = phaseToAudio(phase)
    if (playEntrySfx) applySfx(decision.sfx)
    applyBgm(decision.bgm)
  }

  /** 应用一次领域事件决策。 */
  function applyDecision(decision: AudioDecision): void {
    applySfx(decision.sfx)
    applyBgm(decision.bgm)
  }

  /** 依据当前房间阶段同步期望 BGM（无房间则停止）。 */
  function syncBgmFromPhase(): void {
    const phase = store.room?.phase
    applyBgm(phase ? phaseToAudio(phase).bgm : null)
  }

  // 房间阶段变化：进入时播放入场 SFX 并切换期望 BGM；进入作画时复位「末位秒数」
  watch(
    () => store.room?.phase,
    (phase, previous) => {
      if (!phase || phase === previous) return
      applyPhase(phase, true)
      if (phase === 'drawing') lastWarningSecond = -1
    },
  )

  soundManager.updateSettings(store.settings)

  // 音量/静音变化：同步播放器设置，并按当前阶段重估 BGM（不重复入场 SFX）
  watch(
    () => [
      store.settings.muted,
      store.settings.masterVolume,
      store.settings.soundVolume,
      store.settings.musicVolume,
    ],
    () => {
      soundManager.updateSettings(store.settings)
      syncBgmFromPhase()
    },
  )

  // 离房：room 由存在变为空 → 停止 BGM 并播放离场音
  watch(
    () => Boolean(store.room),
    (hasRoom, previous) => {
      if (previous && !hasRoom) applyDecision(eventToAudio('room-leave'))
    },
  )

  // 断线恢复：由「断开 → 连接」时且带 room，按当前阶段重设 BGM，并播放恢复提示音
  watch(
    () => store.connected,
    (connected, previous) => {
      // 仅在从断开恢复为连接时处理；首次连接（无 room）由下方阶段守卫自然跳过
      if (!connected || previous !== false) return
      if (!store.room?.phase) return
      applyDecision(eventToAudio('session-restore'))
      syncBgmFromPhase()
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
