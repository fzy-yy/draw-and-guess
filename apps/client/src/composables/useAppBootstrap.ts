import { onBeforeUnmount } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import { strings, serverStrings } from '@draw-guess/strings'
import type { MemberConnectionChange } from '@draw-guess/shared'
import { notify } from '@/composables/useToasts'
import { useLobbyStore } from '@/stores/lobby'
import { useProfileStore } from '@/stores/profile'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { attachSocketListeners, socket } from '@/stores/socket'
import { useSettingsStore } from '@/stores/settings'
import { useVocabularyStore } from '@/stores/vocabulary'
import { useRoomSync } from './useRoomSync'

/** 应用级 Socket、恢复、ping 与 HMR 生命周期；start/stop 均幂等。 */
export function useAppBootstrap() {
  const profileStore = useProfileStore()
  const settingsStore = useSettingsStore()
  const sessionStore = useSessionStore()
  const lobbyStore = useLobbyStore()
  const roomStore = useRoomStore()
  const vocabularyStore = useVocabularyStore()
  const roomSync = useRoomSync()
  let detachListeners: (() => void) | undefined
  let pingTimer: number | undefined

  async function register(automatic = false): Promise<void> {
    await sessionStore.register(automatic, (restoredRoom) => {
      roomStore.room = restoredRoom ?? undefined
      if (!restoredRoom) vocabularyStore.clear()
    })
  }

  function onMemberConnectionChanged(change: MemberConnectionChange): void {
    if (change.playerId === sessionStore.playerId || change.playerId === '') return
    if (change.connection === 'left') {
      notify(strings.store.memberLeftGame(change.nickname), 'warning')
      return
    }
    notify(
      change.connection === 'reconnecting'
        ? strings.store.memberDisconnected(change.nickname)
        : strings.store.memberReconnected(change.nickname),
      change.connection === 'reconnecting' ? 'warning' : 'success',
    )
  }

  function start(): void {
    if (detachListeners) return
    detachListeners = attachSocketListeners({
      onConnect: () => {
        sessionStore.connected = true
        sessionStore.connectionLabel = strings.connection.connected
        if (sessionStore.playerId || profileStore.profile.recoveryToken) {
          sessionStore.sessionState = 'restoring'
          void register(true)
        }
      },
      onDisconnect: (reason) => {
        sessionStore.connected = false
        sessionStore.clearRestoreRetry()
        if (
          reason === 'io server disconnect' &&
          (sessionStore.playerId || profileStore.profile.recoveryToken)
        ) {
          sessionStore.sessionState = 'idle'
          roomStore.clearLocalRoomState()
          vocabularyStore.clear()
          sessionStore.page = 'profile'
          sessionStore.connectionLabel = strings.connection.disconnected
          notify(strings.store.sessionTakenOver, 'warning')
          return
        }
        if (sessionStore.playerId || profileStore.profile.recoveryToken)
          sessionStore.sessionState = 'disconnected'
        sessionStore.connectionLabel =
          reason === 'io server disconnect'
            ? strings.connection.unavailable
            : strings.connection.reconnecting
      },
      onReconnectAttempt: () => {
        sessionStore.connectionLabel = strings.connection.reconnecting
        if (sessionStore.playerId || profileStore.profile.recoveryToken)
          sessionStore.sessionState = 'disconnected'
      },
      onIoError: () => {
        sessionStore.connectionLabel = strings.connection.unstable
        if (!socket.connected && (sessionStore.playerId || profileStore.profile.recoveryToken))
          sessionStore.sessionState = 'disconnected'
      },
      onPresence: (snapshot) => (lobbyStore.presence = snapshot),
      onRooms: (rooms) => (lobbyStore.presence.rooms = rooms),
      onRoomSnapshot: roomSync.onRoomSnapshot,
      onMemberConnectionChanged,
      onInviteReceived: (invite) => {
        lobbyStore.invites.push(invite)
        notify(strings.app.inviteReceived(invite.from.nickname, invite.roomName), 'warning')
      },
      onInviteResolved: (id) => {
        lobbyStore.invites = lobbyStore.invites.filter((invite) => invite.id !== id)
      },
      onRoomClosed: (reason) => {
        sessionStore.incrementGeneration()
        roomStore.clearLocalRoomState()
        vocabularyStore.clear()
        if (reason === serverStrings.notices.kickedReason) sessionStore.kickedNotice = true
        notify(reason, 'warning')
      },
      onSystemNotice: (text) => notify(text, 'warning'),
      onSystemError: (message) => notify(message, 'error'),
      onInvalidPush: () => void roomSync.requestFullSnapshot(),
      onDrawStrokeBatch: roomSync.onStroke,
      onDrawFillCommit: roomSync.onFill,
    })
    settingsStore.saveSettings(sessionStore.playerId)
    if (socket.connected && profileStore.profile.recoveryToken)
      queueMicrotask(() => void register(true))
    pingTimer = window.setInterval(
      () => void sessionStore.measureLatency(),
      APP_CONFIG.network.pingIntervalMs,
    )
  }

  function stop(): void {
    if (pingTimer !== undefined) window.clearInterval(pingTimer)
    pingTimer = undefined
    sessionStore.clearRestoreRetry()
    detachListeners?.()
    detachListeners = undefined
  }

  onBeforeUnmount(stop)
  return { start, stop }
}
