/**
  全局组合 Store（Facade）与 Socket 网关。
  组合各领域子 Store（Profile / Settings / Session / Lobby / Room / Gameplay / Vocabulary），
  保持对视图层完全向后兼容的统一调用接口。
*/
import { defineStore, storeToRefs } from 'pinia'
import { APP_CONFIG, PUBLIC_CONFIG } from '@draw-guess/config'
import { strings, serverStrings } from '@draw-guess/strings'
import { EVENTS, RoomSnapshotSchema, type MemberConnectionChange } from '@draw-guess/shared'
import { notify as pushToast } from '@/composables/useToasts'
import { attachSocketListeners, socket } from './socket.ts'
import { createRequester } from './request.ts'
import { useProfileStore, loadProfile, type StoredProfile } from './profile.ts'
import { useSettingsStore, type LocalSettings } from './settings.ts'
import {
  useSessionStore,
  type ConnectionLabel,
  type SessionState,
  type ShellPage,
} from './session.ts'
import { useLobbyStore } from './lobby.ts'
import { useRoomStore } from './room.ts'
import { useGameplayStore } from './gameplay.ts'
import { useVocabularyStore } from './vocabulary.ts'
import { acceptDrawingIncrement, acceptRoomSnapshot } from './snapshot-gate.ts'

export type { ConnectionLabel, SessionState, ShellPage, StoredProfile, LocalSettings }

export const useGameStore = defineStore('game', () => {
  const profileStore = useProfileStore()
  const settingsStore = useSettingsStore()
  const sessionStore = useSessionStore()
  const lobbyStore = useLobbyStore()
  const roomStore = useRoomStore()
  const gameplayStore = useGameplayStore()
  const vocabularyStore = useVocabularyStore()

  const { profile } = storeToRefs(profileStore)
  const { settings } = storeToRefs(settingsStore)
  const {
    playerId,
    page,
    connected,
    sessionState,
    connectionLabel,
    latency,
    clockOffset,
    busy,
    kickedNotice,
  } = storeToRefs(sessionStore)
  const { presence, invites } = storeToRefs(lobbyStore)
  const { room, me, isHost, isDrawer } = storeToRefs(roomStore)
  const { vocabulary } = storeToRefs(vocabularyStore)
  const { drawRevision } = storeToRefs(gameplayStore)

  const request = createRequester({ socket, notify: pushToast })

  function notify(text: string, type: 'success' | 'warning' | 'error' = 'success'): void {
    pushToast(text, type)
  }

  async function register(automatic = false): Promise<void> {
    await sessionStore.register(automatic, (restoredRoom) => {
      roomStore.room = restoredRoom ?? undefined
      if (!restoredRoom) vocabularyStore.clear()
    })
  }

  function saveSettings(): void {
    settingsStore.saveSettings(sessionStore.playerId)
  }

  function resetSettings(): void {
    settingsStore.resetSettings(sessionStore.playerId)
  }

  async function clearProfile(): Promise<void> {
    if (sessionStore.playerId) {
      try {
        await request(EVENTS.sessionLogout, {}, { quiet: true })
      } catch {
        // 忽略静默错误
      }
    }
    localStorage.removeItem(APP_CONFIG.app.storageKey)
    profileStore.profile = loadProfile()
    sessionStore.playerId = ''
    sessionStore.incrementGeneration()
    roomStore.clearLocalRoomState()
    vocabularyStore.clear()
    lobbyStore.invites = []
    sessionStore.kickedNotice = false
    sessionStore.sessionState = 'idle'
    sessionStore.clearRestoreRetry()
    sessionStore.page = 'profile'
    if (socket.connected) {
      socket.disconnect()
      socket.connect()
    }
    notify(strings.store.profileCleared, 'warning')
  }

  async function respondInvite(inviteId: string, accept: boolean): Promise<void> {
    const joinedRoom = await lobbyStore.respondInvite(inviteId, accept)
    if (joinedRoom) {
      roomStore.room = joinedRoom
    }
  }

  // Socket 事件集中网关
  let resyncInFlight = false
  let lastResyncAt = 0

  /**
   * 全量快照修复通道：同一时刻仅允许一个请求，并用冷却窗口阻止恶意坏推送形成请求风暴。
   * 响应仍经过完整 RoomSnapshot schema 和身份/版本门禁，旧请求不能覆盖新房间。
   */
  async function requestFullSnapshot(): Promise<void> {
    const current = roomStore.room
    if (!current || resyncInFlight) return
    const now = Date.now()
    if (now - lastResyncAt < APP_CONFIG.network.stateResyncCooldownMs) return
    resyncInFlight = true
    lastResyncAt = now
    const requestContext = {
      generation: sessionStore.generation,
      roomId: current.id,
      gameId: current.game?.gameId,
      roundId: current.game?.roundId,
    }
    try {
      const result = await request<unknown>(
        EVENTS.stateResync,
        {
          roomId: requestContext.roomId,
          ...(requestContext.gameId ? { gameId: requestContext.gameId } : {}),
          ...(requestContext.roundId ? { roundId: requestContext.roundId } : {}),
        },
        { quiet: true, retry: true },
      )
      if (!result.ok || result.data === undefined) return
      const parsed = RoomSnapshotSchema.safeParse(result.data)
      if (!parsed.success) return
      if (
        sessionStore.generation !== requestContext.generation ||
        roomStore.room?.id !== requestContext.roomId ||
        parsed.data.id !== requestContext.roomId
      )
        return
      if (acceptRoomSnapshot(roomStore.room, parsed.data) !== 'accept') return
      roomStore.room = parsed.data
    } finally {
      resyncInFlight = false
    }
  }

  const detachSocketListeners = attachSocketListeners({
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
      if (sessionStore.playerId || profileStore.profile.recoveryToken) {
        sessionStore.sessionState = 'disconnected'
      }
      sessionStore.connectionLabel =
        reason === 'io server disconnect'
          ? strings.connection.unavailable
          : strings.connection.reconnecting
    },
    onReconnectAttempt: () => {
      sessionStore.connectionLabel = strings.connection.reconnecting
      if (sessionStore.playerId || profileStore.profile.recoveryToken) {
        sessionStore.sessionState = 'disconnected'
      }
    },
    onIoError: () => {
      sessionStore.connectionLabel = strings.connection.unstable
      if (!socket.connected && (sessionStore.playerId || profileStore.profile.recoveryToken)) {
        sessionStore.sessionState = 'disconnected'
      }
    },
    onPresence: (snapshot) => {
      lobbyStore.presence = snapshot
    },
    onRooms: (rooms) => {
      lobbyStore.presence.rooms = rooms
    },
    onRoomSnapshot: (snapshot) => {
      const currentSnapshot = roomStore.room
      const decision = acceptRoomSnapshot(currentSnapshot, snapshot)
      if (decision === 'ignore') return
      if (decision === 'resync') {
        void requestFullSnapshot()
        return
      }
      if (snapshot.game?.strokesOmitted) {
        const localGame = currentSnapshot?.game
        if (
          !localGame ||
          localGame.gameId !== snapshot.game.gameId ||
          localGame.roundId !== snapshot.game.roundId ||
          localGame.drawingRevision > snapshot.game.drawingRevision
        ) {
          void requestFullSnapshot()
          return
        }
        const localStrokes = localGame.strokes
        const localMaxSequence = localStrokes.reduce(
          (max, command) => Math.max(max, command.sequence),
          -1,
        )
        if (localMaxSequence < snapshot.game.lastSequence) {
          void requestFullSnapshot()
          return
        }
        snapshot = {
          ...snapshot,
          game: { ...snapshot.game, strokes: localStrokes, strokesOmitted: false },
        }
      }
      roomStore.room = snapshot
    },
    onMemberConnectionChanged: (change: MemberConnectionChange) => {
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
    },
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
      if (reason === serverStrings.notices.kickedReason) {
        sessionStore.kickedNotice = true
      }
      notify(reason, 'warning')
    },
    onSystemNotice: (text) => notify(text, 'warning'),
    onSystemError: (message) => notify(message, 'error'),
    onInvalidPush: () => {
      void requestFullSnapshot()
    },
    onDrawStrokeBatch: (meta, stroke) => {
      const decision = acceptDrawingIncrement(roomStore.room, meta)
      if (decision === 'resync') void requestFullSnapshot()
      if (decision !== 'accept') return
      gameplayStore.handleStrokeBatch(meta.roundId, stroke)
      if (roomStore.room?.game) roomStore.room.game.drawingRevision = meta.drawingRevision
    },
    onDrawFillCommit: (meta, fill) => {
      const decision = acceptDrawingIncrement(roomStore.room, meta)
      if (decision === 'resync') void requestFullSnapshot()
      if (decision !== 'accept') return
      gameplayStore.handleFillCommit(meta.roundId, fill)
      if (roomStore.room?.game) roomStore.room.game.drawingRevision = meta.drawingRevision
    },
  })

  // 初始化设置
  saveSettings()
  if (socket.connected && profileStore.profile.recoveryToken) {
    queueMicrotask(() => void register(true))
  }
  const pingTimer = window.setInterval(
    () => void sessionStore.measureLatency(),
    APP_CONFIG.network.pingIntervalMs,
  )

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.clearInterval(pingTimer)
      sessionStore.clearRestoreRetry()
      detachSocketListeners()
    })
  }

  return {
    config: PUBLIC_CONFIG,
    // 子 Store 属性映射（由 storeToRefs 保持响应式代理）
    profile,
    settings,
    playerId,
    page,
    connected,
    sessionState,
    connectionLabel,
    latency,
    clockOffset,
    presence,
    room,
    vocabulary,
    invites,
    kickedNotice,
    drawRevision,
    busy,
    me,
    isHost,
    isDrawer,

    // 方法暴露
    notify,
    register,
    randomizeProfile: profileStore.randomizeProfile,
    saveSettings,
    resetSettings,
    clearProfile,
    updateProfile: profileStore.updateProfile,
    createRoom: roomStore.createRoom,
    joinRoom: roomStore.joinRoom,
    joinPrivateRoom: roomStore.joinPrivateRoom,
    leaveRoom: roomStore.leaveRoom,
    setReady: roomStore.setReady,
    updateRoomSettings: roomStore.updateRoomSettings,
    loadVocabulary: vocabularyStore.loadVocabulary,
    saveVocabulary: vocabularyStore.saveVocabulary,
    selectVocabularyPackage: vocabularyStore.selectVocabularyPackage,
    cancelVocabularyRequests: vocabularyStore.cancelPending,
    startGame: gameplayStore.startGame,
    chooseWord: gameplayStore.chooseWord,
    rerollWords: gameplayStore.rerollWords,
    submitGuess: gameplayStore.submitGuess,
    sendPreset: gameplayStore.sendPreset,
    sendStroke: gameplayStore.sendStroke,
    sendFill: gameplayStore.sendFill,
    drawAction: gameplayStore.drawAction,
    pause: gameplayStore.pause,
    resume: gameplayStore.resume,
    endEarly: gameplayStore.endEarly,
    leaveGame: gameplayStore.leaveGame,
    returnWaiting: gameplayStore.returnWaiting,
    kick: roomStore.kick,
    transferHost: roomStore.transferHost,
    invite: lobbyStore.invite,
    respondInvite,
    dismissKickedNotice: sessionStore.dismissKickedNotice,
  }
})
