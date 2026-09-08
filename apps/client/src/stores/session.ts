/**
  会话与连接状态 Store。
  管理 Socket 传输层状态、服务端会话注册与恢复、延迟时钟探测、页面路由切换。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { APP_CONFIG, PUBLIC_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { EVENTS, type SessionRegistration } from '@draw-guess/shared'
import { notify } from '@/composables/useToasts'
import { socket } from './socket.ts'
import { createRequester } from './request.ts'
import { useProfileStore } from './profile.ts'
import { useSettingsStore } from './settings.ts'

export type ConnectionLabel = (typeof strings.connection)[keyof typeof strings.connection]
export type ShellPage = 'profile' | 'lobby' | 'settings'
export type SessionState = 'idle' | 'ready' | 'disconnected' | 'restoring'

export const useSessionStore = defineStore('session', () => {
  const profileStore = useProfileStore()
  const settingsStore = useSettingsStore()
  const request = createRequester({ socket, notify })

  const playerId = ref('')
  const page = ref<ShellPage>('profile')
  const connected = ref(socket.connected)
  const sessionState = ref<SessionState>(profileStore.profile.recoveryToken ? 'restoring' : 'idle')
  const connectionLabel = ref<ConnectionLabel>(strings.connection.connecting)
  const latency = ref(0)
  const clockOffset = ref(0)
  const busy = ref(false)
  const kickedNotice = ref(false)
  const protocolMismatch = ref(false)
  const generation = ref(0)
  let restoreRetryTimer: number | undefined

  function incrementGeneration(): void {
    generation.value += 1
  }

  function clearRestoreRetry(): void {
    window.clearTimeout(restoreRetryTimer)
    restoreRetryTimer = undefined
  }

  function markProtocolMismatch(): void {
    protocolMismatch.value = true
    clearRestoreRetry()
  }

  function scheduleRestoreRetry(registerFn: (automatic?: boolean) => Promise<void>): void {
    clearRestoreRetry()
    restoreRetryTimer = window.setTimeout(() => {
      restoreRetryTimer = undefined
      if (socket.connected && sessionState.value === 'restoring') void registerFn(true)
    }, PUBLIC_CONFIG.network.sessionRestoreRetryMs)
  }

  /** 注册新身份或凭服务端秘密令牌恢复既有身份。 */
  async function register(
    automatic = false,
    onRestoredRoom?: (room: SessionRegistration['room']) => void,
  ): Promise<void> {
    if (protocolMismatch.value) return
    if (busy.value) return
    if (!socket.connected) {
      if (profileStore.profile.recoveryToken || playerId.value) sessionState.value = 'disconnected'
      if (!automatic) notify(strings.store.notConnected, 'warning')
      return
    }
    if (automatic) sessionState.value = 'restoring'
    clearRestoreRetry()
    busy.value = true
    try {
      const result = await request(
        EVENTS.sessionRegister,
        {
          protocolVersion: APP_CONFIG.app.protocolVersion,
          profile: {
            nickname: profileStore.profile.nickname,
            avatarId: profileStore.profile.avatarId,
          },
          preferences: {
            discoverable: settingsStore.settings.discoverable,
            acceptsInvites: settingsStore.settings.acceptsInvites,
          },
          ...(profileStore.profile.recoveryToken
            ? { recoveryToken: profileStore.profile.recoveryToken }
            : {}),
        },
        { quiet: automatic },
      )

      if (!result.ok) {
        if (result.code === 'PROTOCOL_MISMATCH') {
          markProtocolMismatch()
          return
        }
        const retryable = result.failureKind === 'transport'
        if (automatic && profileStore.profile.recoveryToken && retryable) {
          scheduleRestoreRetry((auto) => register(auto, onRestoredRoom))
        } else if (automatic) {
          sessionState.value = 'idle'
          playerId.value = ''
          page.value = 'profile'
          notify(result.error ?? strings.request.genericFailure, 'error')
        } else if (
          sessionState.value === 'restoring' &&
          profileStore.profile.recoveryToken &&
          retryable
        ) {
          scheduleRestoreRetry((auto) => register(auto, onRestoredRoom))
        }
        return
      }

      playerId.value = result.data.player.id
      profileStore.profile = {
        nickname: result.data.player.nickname,
        avatarId: result.data.player.avatarId,
        recoveryToken: result.data.recoveryToken,
      }
      profileStore.saveProfile()

      if (onRestoredRoom) {
        onRestoredRoom(result.data.room)
      }

      page.value = 'lobby'
      sessionState.value = 'ready'
      notify(
        result.data.restored
          ? result.data.room
            ? strings.store.gameRestored
            : strings.store.restored
          : strings.store.enteredLobby,
      )
    } finally {
      busy.value = false
    }
  }

  async function measureLatency(): Promise<void> {
    if (!playerId.value) return
    const started = Date.now()
    const result = await request(EVENTS.networkPing, { clientTime: started }, { quiet: true })
    if (!result.ok) return
    const rtt = Date.now() - started
    // Date.now() 只有毫秒精度：局域网亚毫秒级往返会测得 0，而展示层把 0 视作「尚未测得」
    // （网络按钮退回「—」占位）。这里把 0 收敛为 1ms 下限，保证任何成功探测都产生有效延迟值；
    // 探测失败时沿用上一次的延迟与连接状态，直到下一次探测成功才更新。
    latency.value = Math.max(1, rtt)
    clockOffset.value = result.data.serverTime - (started + rtt / 2)
  }

  function dismissKickedNotice(): void {
    kickedNotice.value = false
  }

  return {
    playerId,
    page,
    connected,
    sessionState,
    connectionLabel,
    latency,
    clockOffset,
    busy,
    kickedNotice,
    protocolMismatch,
    generation,
    incrementGeneration,
    register,
    measureLatency,
    clearRestoreRetry,
    markProtocolMismatch,
    dismissKickedNotice,
  }
})
