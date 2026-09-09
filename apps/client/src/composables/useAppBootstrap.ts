import { onBeforeUnmount } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import { strings, serverStrings } from '@draw-guess/strings'
import { EVENTS, type MemberConnectionChange, type ServerPushEventName } from '@draw-guess/shared'
import type { InvalidPushReason } from '@/stores/push-protocol'
import { useGameTransport, type GameTransport } from '@/application/game-transport'
import { useLobbyStore } from '@/stores/lobby'
import { useProfileStore } from '@/stores/profile'
import { useRoomStore } from '@/stores/room'
import { useSessionStore } from '@/stores/session'
import { useSettingsStore } from '@/stores/settings'
import { useVocabularyStore } from '@/stores/vocabulary'
import { useRoomSync } from './useRoomSync'

/** 应用级 Socket、恢复、ping 与 HMR 生命周期；start/stop 均幂等。 */
export function useAppBootstrap(transport: GameTransport = useGameTransport()) {
  const { notify } = transport
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

  function handleConnect(): void {
    sessionStore.connected = true
    sessionStore.connectionLabel = strings.connection.connected
    if (sessionStore.playerId || profileStore.profile.recoveryToken) {
      sessionStore.sessionState = 'restoring'
      void register(true)
    }
  }

  function handleInvalidPush(event: ServerPushEventName, reason: InvalidPushReason): void {
    if (reason === 'protocol_mismatch') {
      sessionStore.markProtocolMismatch()
      return
    }
    if (event === EVENTS.presenceSnapshot) {
      void lobbyStore.refreshPresence()
      return
    }
    if (event === EVENTS.roomListChanged) {
      void lobbyStore.refreshRooms()
      return
    }
    if (
      event === EVENTS.roomSnapshot ||
      event === EVENTS.roomMemberConnectionChanged ||
      event === EVENTS.roomClosed ||
      event === EVENTS.drawStrokeBatch ||
      event === EVENTS.drawFillCommit
    )
      void roomSync.requestFullSnapshot()
  }

  function start(): void {
    if (detachListeners) return
    detachListeners = transport.attach({
      onConnect: handleConnect,
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
        if (
          !transport.socket.connected &&
          (sessionStore.playerId || profileStore.profile.recoveryToken)
        )
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
      onInvalidPush: handleInvalidPush,
      onDrawStrokeBatch: roomSync.onStroke,
      onDrawFillCommit: roomSync.onFill,
    })
    // 所有具名监听器注册完成后才允许连接，快速 connect/push 不会越过初始化窗口。
    if (transport.socket.connected) handleConnect()
    else transport.connect()
    settingsStore.saveSettings(sessionStore.playerId)
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
    transport.disconnect()
    sessionStore.connected = false
  }

  onBeforeUnmount(stop)
  return { start, stop }
}
