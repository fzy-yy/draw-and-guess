/**
  房间生命周期与成员管理 Store。
  管理当前所在房间快照、席位与准备状态、规则修改与房主移交。
*/
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  EVENTS,
  type RoomSettings,
  type RoomSnapshot,
  type RoomVisibility,
} from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameTransport } from '@/application/game-transport'
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
    settings: RoomSettings
  }): Promise<boolean> {
    const snapshot = await request(EVENTS.roomCreate, input)
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
    notify(strings.store.roomLeft)
  }

  async function setReady(ready: boolean): Promise<void> {
    await request(EVENTS.roomSetReady, { ready })
  }

  async function updateRoomSettings(patch: Partial<RoomSettings>): Promise<boolean> {
    if (!room.value) return false
    const result = await request(EVENTS.roomUpdateSettings, {
      patch,
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
