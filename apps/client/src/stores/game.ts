/**
  全局组合 Store（Facade）与 Socket 网关。
  组合各领域子 Store（Profile / Settings / Session / Lobby / Room / Gameplay / Vocabulary），
  保持对视图层完全向后兼容的统一调用接口。
*/
import { defineStore, storeToRefs } from 'pinia'
import { APP_CONFIG, PUBLIC_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { EVENTS } from '@draw-guess/shared'
import { notify as pushToast } from '@/composables/useToasts'
import { socket } from './socket.ts'
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
    protocolMismatch,
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
    protocolMismatch,
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
    requestFullSnapshot: roomStore.requestFullSnapshot,
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
