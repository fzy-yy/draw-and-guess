/**
  全局组合 Store（Facade）：视图层的统一动作入口与跨领域编排点。
  组合各领域子 Store（Profile / Settings / Session / Lobby / Room / Gameplay / Vocabulary），
  保持对视图层完全向后兼容的统一调用接口。
  Socket 网关不在本文件——连接装配归 application/game-transport.ts 与 useAppBootstrap
  （ADR-0019/0020），Facade 只是经 useGameTransport 取 notify/request 的转接消费者。
*/
import { defineStore, storeToRefs } from 'pinia'
import { PUBLIC_CONFIG } from '@draw-guess/config'
import { strings } from '@draw-guess/strings'
import { useGameTransport } from '@/application/game-transport'
import { useProfileStore } from './profile.ts'
import { useSettingsStore } from './settings.ts'
import { useSessionStore } from './session.ts'
import { useLobbyStore } from './lobby.ts'
import { useRoomStore } from './room.ts'
import { useGameplayStore } from './gameplay.ts'
import { useVocabularyStore } from './vocabulary.ts'
import { useResyncStore } from './resync.ts'

export const useGameStore = defineStore('game', () => {
  const transport = useGameTransport()
  const profileStore = useProfileStore()
  const settingsStore = useSettingsStore()
  const sessionStore = useSessionStore()
  const lobbyStore = useLobbyStore()
  const roomStore = useRoomStore()
  const gameplayStore = useGameplayStore()
  const vocabularyStore = useVocabularyStore()
  const resyncStore = useResyncStore()

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

  function notify(text: string, type: 'success' | 'warning' | 'error' = 'success'): void {
    transport.notify(text, type)
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

  /**
   * 注销身份并清空本机状态：会话域动作（会话/资料/连接）+ 各领域 store 的本地清理。
   * 跨领域编排只允许保留在 Facade，组件不得自行串联多个 store。
   */
  async function clearProfile(): Promise<void> {
    await sessionStore.clearProfile()
    roomStore.clearLocalRoomState()
    vocabularyStore.clear()
    lobbyStore.invites = []
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
    requestFullSnapshot: resyncStore.requestFullSnapshot,
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
