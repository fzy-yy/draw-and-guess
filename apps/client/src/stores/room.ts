/**
  房间生命周期与成员管理 Store。
  管理当前所在房间快照、席位与准备状态、规则修改与房主移交。
*/
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { APP_CONFIG } from '@draw-guess/config'
import {
  EVENTS,
  RoomSnapshotSchema,
  type RoomSettings,
  type RoomSnapshot,
  type RoomVisibility,
} from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameTransport } from '@/application/game-transport'
import { useSessionStore } from './session.ts'
import { acceptRoomSnapshot } from './snapshot-gate.ts'

export const useRoomStore = defineStore('room', () => {
  const { request, notify } = useGameTransport()
  const sessionStore = useSessionStore()
  const room = ref<RoomSnapshot>()
  let resyncInFlight = false
  let lastResyncAt = 0

  const me = computed(() =>
    room.value?.members.find((member) => member.id === sessionStore.playerId),
  )
  const isHost = computed(() => room.value?.hostId === sessionStore.playerId)
  const isDrawer = computed(() => room.value?.game?.drawerId === sessionStore.playerId)

  function clearLocalRoomState(): void {
    room.value = undefined
  }

  /** 请求一次受冷却保护的权威全量快照；迟到响应必须仍属于发起时的会话与房间。 */
  async function requestFullSnapshot(): Promise<void> {
    const current = room.value
    if (!current || resyncInFlight) return
    const now = Date.now()
    if (now - lastResyncAt < APP_CONFIG.network.stateResyncCooldownMs) return
    resyncInFlight = true
    lastResyncAt = now
    const context = {
      generation: sessionStore.generation,
      roomId: current.id,
      gameId: current.game?.gameId,
      roundId: current.game?.roundId,
    }
    try {
      const result = await request(
        EVENTS.stateResync,
        {
          roomId: context.roomId,
          ...(context.gameId ? { gameId: context.gameId } : {}),
          ...(context.roundId ? { roundId: context.roundId } : {}),
        },
        { quiet: true, retry: true },
      )
      if (!result.ok) return
      if (sessionStore.generation !== context.generation || room.value?.id !== context.roomId)
        return
      if (result.data === undefined) {
        room.value = undefined
        return
      }
      const parsed = RoomSnapshotSchema.safeParse(result.data)
      if (
        !parsed.success ||
        parsed.data.id !== context.roomId ||
        acceptRoomSnapshot(room.value, parsed.data) !== 'accept'
      )
        return
      room.value = parsed.data
    } finally {
      resyncInFlight = false
    }
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
    requestFullSnapshot,
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
