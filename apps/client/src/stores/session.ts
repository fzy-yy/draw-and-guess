/**
  会话与连接状态 Store。
  管理 Socket 传输层状态、服务端会话注册与恢复、延迟时钟探测、页面路由切换。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { APP_CONFIG, PUBLIC_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { EVENTS, type SessionRegistration } from '@draw-guess/shared'
import { useGameTransport } from '@/application/game-transport'
import { useProfileStore } from './profile.ts'
import { useSettingsStore } from './settings.ts'
import { getErrorRecoveryAction } from './error-recovery.ts'

export type ConnectionLabel = (typeof strings.ui.connection)[keyof typeof strings.ui.connection]
export type ShellPage = 'profile' | 'lobby' | 'settings'
export type SessionState = 'idle' | 'ready' | 'disconnected' | 'restoring'

export const useSessionStore = defineStore('session', () => {
  const transport = useGameTransport()
  const { request, notify } = transport
  const profileStore = useProfileStore()
  const settingsStore = useSettingsStore()

  const playerId = ref('')
  const page = ref<ShellPage>('profile')
  const connected = ref(transport.socket.connected)
  const sessionState = ref<SessionState>(profileStore.profile.recoveryToken ? 'restoring' : 'idle')
  const connectionLabel = ref<ConnectionLabel>(strings.ui.connection.connecting)
  const latency = ref(0)
  const clockOffset = ref(0)
  const busy = ref(false)
  const kickedNotice = ref(false)
  const protocolMismatch = ref(false)
  /**
   * 会话世代：身份/会话边界的单调计数。在途请求与异步回调（词库迟到响应、
   * 全量重同步回写，ADR-0025 / vocabulary-request-context）据此作废「旧世代发起、
   * 新世代才返回」的结果，避免旧身份的响应污染当前 UI。
   */
  const generation = ref(0)
  let restoreRetryTimer: number | undefined

  /**
   * 推进世代（注销 / 会话失效重置时调用）：世代一变，所有捕获了旧世代的在途回写
   * 自动失效——不需要逐个取消请求，只凭世代比对即可拦截迟到结果。
   */
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
      if (transport.socket.connected && sessionState.value === 'restoring') void registerFn(true)
    }, PUBLIC_CONFIG.network.sessionRestoreRetryMs)
  }

  /** 注册新身份或凭服务端秘密令牌恢复既有身份。 */
  async function register(
    automatic = false,
    onRestoredRoom?: (room: SessionRegistration['room']) => void,
  ): Promise<void> {
    if (protocolMismatch.value) return
    if (busy.value) return
    if (!transport.socket.connected) {
      if (profileStore.profile.recoveryToken || playerId.value) sessionState.value = 'disconnected'
      if (!automatic) notify(strings.ui.store.notConnected, 'warning')
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
        // 手动注册：失败弹 Toast 且重试；自动重连注册：静默且单次尝试——失败由重连循环
        // 下一轮再触发，避免重试风暴与断线期刷屏（旧 quiet: automatic 的双义在此显式化）。
        { retry: !automatic, notify: automatic ? 'silent' : 'always' },
      )

      if (!result.ok) {
        if (getErrorRecoveryAction(result.code) === 'require-upgrade') {
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
          notify(result.error, 'error')
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
            ? strings.ui.store.gameRestored
            : strings.ui.store.restored
          : strings.ui.store.enteredLobby,
      )
    } finally {
      busy.value = false
    }
  }

  async function measureLatency(): Promise<void> {
    if (!playerId.value) return
    const started = Date.now()
    const result = await request(
      EVENTS.networkPing,
      { clientTime: started },
      // 周期探测：失败静默、不重试（下一轮间隔自然补测）。
      { retry: false, notify: 'silent' },
    )
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

  /**
   * 注销当前身份并回到资料页：只处理会话、本地资料与连接。
   * 房间席位与词库等跨领域清理由 Facade 统一编排（见 stores/game.ts 的同名方法），
   * 避免会话域反向依赖房间/词库域。
   */
  async function clearProfile(): Promise<void> {
    // 注销尽力而为：断线时静默放过（本地清理照常进行），不阻塞、不重试。
    if (playerId.value) await request(EVENTS.sessionLogout, {}, { retry: false, notify: 'silent' })
    profileStore.clearStoredProfile()
    playerId.value = ''
    incrementGeneration()
    kickedNotice.value = false
    sessionState.value = 'idle'
    clearRestoreRetry()
    page.value = 'profile'
    if (transport.socket.connected) {
      transport.disconnect()
      transport.connect()
    }
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
    clearProfile,
  }
})
