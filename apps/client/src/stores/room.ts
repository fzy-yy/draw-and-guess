/**
  房间生命周期与成员管理 Store。
  管理当前所在房间快照、席位与准备状态、规则修改与房主移交。
*/
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  DEFAULT_GAME_MODE,
  EVENTS,
  type GameMode,
  type RoomSettings,
  type RoomSnapshot,
  type RoomVisibility,
} from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameTransport } from '@/application/game-transport'
import { scopeSettingsPatch } from '@/utils/room-facts'
import { useSessionStore } from './session.ts'

export const useRoomStore = defineStore('room', () => {
  const { request, notify } = useGameTransport()
  const sessionStore = useSessionStore()
  const room = ref<RoomSnapshot>()

  const me = computed(() =>
    room.value?.members.find((member) => member.id === sessionStore.playerId),
  )
  const isHost = computed(() => room.value?.hostId === sessionStore.playerId)
  const isDrawer = computed(() => room.value?.game?.drawerId === sessionStore.playerId)

  function clearLocalRoomState(): void {
    room.value = undefined
  }

  async function createRoom(input: {
    name: string
    visibility: RoomVisibility
    /** 玩法模式：建房时确定（S27 / S28）；缺省保持经典模式，与协议默认值同源。 */
    gameMode?: GameMode
    settings: RoomSettings
  }): Promise<boolean> {
    const snapshot = await request(EVENTS.roomCreate, {
      ...input,
      gameMode: input.gameMode ?? DEFAULT_GAME_MODE,
    })
    if (!snapshot.ok) return false
    room.value = snapshot.data
    return true
  }

  async function joinRoom(roomId: string): Promise<boolean> {
    const snapshot = await request(EVENTS.roomJoin, { roomId })
    if (!snapshot.ok) return false
    room.value = snapshot.data
    return true
  }

  async function joinPrivateRoom(code: string): Promise<boolean> {
    const snapshot = await request(EVENTS.roomJoinPrivate, { code })
    if (!snapshot.ok) return false
    room.value = snapshot.data
    return true
  }

  async function leaveRoom(): Promise<void> {
    const result = await request(EVENTS.roomLeave)
    if (!result.ok) return
    clearLocalRoomState()
    notify(strings.ui.store.roomLeft)
  }

  async function setReady(ready: boolean): Promise<void> {
    await request(EVENTS.roomSetReady, { ready })
  }

  async function updateRoomSettings(patch: Partial<RoomSettings>): Promise<boolean> {
    if (!room.value) return false
    // 规则弹窗回传完整草稿，而服务端按模式白名单严格拒绝不生效字段（S52），
    // 因此先按当前模式裁剪成生效键补丁再上送（清单与服务端同口径，见 utils/room-facts.ts）。
    const result = await request(EVENTS.roomUpdateSettings, {
      patch: scopeSettingsPatch(patch, room.value.gameMode),
      expectedVersion: room.value.stateVersion,
    })
    return result.ok
  }

  async function kick(targetId: string): Promise<void> {
    await request(EVENTS.roomKick, { targetId })
  }

  async function transferHost(targetId: string): Promise<boolean> {
    const result = await request(EVENTS.roomTransferHost, { targetId })
    return result.ok
  }

  return {
    room,
    me,
    isHost,
    isDrawer,
    clearLocalRoomState,
    createRoom,
    joinRoom,
    joinPrivateRoom,
    leaveRoom,
    setReady,
    updateRoomSettings,
    kick,
    transferHost,
  }
})
