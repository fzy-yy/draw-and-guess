import { onBeforeUnmount } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import {
  EVENTS,
  ROOM_CLOSE_CODE,
  type MemberConnectionChange,
  type ServerPushEventName,
} from '@draw-guess/shared'
import type { InvalidPushReason } from '@/stores/push-protocol'
import { useGameTransport, type GameTransport } from '@/application/game-transport'
import { useGameStore } from '@/stores/game'
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
  const gameStore = useGameStore()
  const profileStore = useProfileStore()
  const settingsStore = useSettingsStore()
  const sessionStore = useSessionStore()
  const lobbyStore = useLobbyStore()
  const roomStore = useRoomStore()
  const vocabularyStore = useVocabularyStore()
  const roomSync = useRoomSync()
  let detachListeners: (() => void) | undefined
  let pingTimer: number | undefined

  // 注册与「恢复后落位房间/清空词库」的跨领域编排统一委托 Facade，
  // 组合式函数不再复制第二份恢复回调（见 stores/game.ts 的 register）。
  async function register(automatic = false): Promise<void> {
    await gameStore.register(automatic)
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
    const roomScoped =
      event === EVENTS.roomSnapshot ||
      event === EVENTS.roomMemberConnectionChanged ||
      event === EVENTS.roomClosed ||
      event === EVENTS.drawStrokeBatch ||
      event === EVENTS.drawFillCommit
    if (roomScoped) {
      void roomSync.requestFullSnapshot('invalid_push')
      return
    }
    // 非房间 push 无需覆盖本地房间，但仍用无内容的枚举原因让服务端计数；不回传非法载荷。
    void transport.request(
      EVENTS.stateResync,
      { reason: 'invalid_push' },
      { quiet: true, retry: false },
    )
    if (event === EVENTS.presenceSnapshot) {
      void lobbyStore.refreshPresence()
      return
    }
    if (event === EVENTS.roomListChanged) {
      void lobbyStore.refreshRooms()
      return
    }
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
      onRoomClosed: (reason, code) => {
        sessionStore.incrementGeneration()
        roomStore.clearLocalRoomState()
        vocabularyStore.clear()
        // 业务语义只看稳定关闭码；reason 仅作为展示文案，允许随时改文案或做本地化。
        if (code === ROOM_CLOSE_CODE.kicked) sessionStore.kickedNotice = true
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
