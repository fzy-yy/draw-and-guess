/**
  大厅在线状态与定向邀请 Store。
  管理大厅房间列表、在线玩家发现列表、接收与应答邀请。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { EVENTS, type Invite, type PresenceSnapshot, type RoomSnapshot } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { useGameTransport } from '@/application/game-transport'

export const useLobbyStore = defineStore('lobby', () => {
  const { request, notify } = useGameTransport()
  const presence = ref<PresenceSnapshot>({ players: [], rooms: [] })
  const invites = ref<Invite[]>([])
  let presenceRequestInFlight = false
  let roomListRequestInFlight = false

  /** presence 推送损坏时可重复调用的权威全量入口；并发请求合并为一次。 */
  async function refreshPresence(): Promise<void> {
    if (presenceRequestInFlight) return
    presenceRequestInFlight = true
    try {
      const result = await request(EVENTS.presenceGet, {}, { quiet: true, retry: true })
      if (result.ok) presence.value = result.data
    } finally {
      presenceRequestInFlight = false
    }
  }

  /** 房间列表推送损坏时仅补拉公开房，避免覆盖同期到达的玩家 presence。 */
  async function refreshRooms(): Promise<void> {
    if (roomListRequestInFlight) return
    roomListRequestInFlight = true
    try {
      const result = await request(EVENTS.roomList, {}, { quiet: true, retry: true })
      if (result.ok) presence.value.rooms = result.data
    } finally {
      roomListRequestInFlight = false
    }
  }

  async function invite(targetId: string): Promise<void> {
    const result = await request(EVENTS.inviteSend, { targetId })
    if (!result.ok) return
    notify(strings.store.inviteSent)
  }

  async function respondInvite(
    inviteId: string,
    accept: boolean,
  ): Promise<RoomSnapshot | undefined> {
    const joined = await request(EVENTS.inviteRespond, {
      inviteId,
      accept,
    })
    if (!joined.ok) return undefined
    invites.value = invites.value.filter((inv) => inv.id !== inviteId)
    return joined.data
  }

  return {
    presence,
    invites,
    refreshPresence,
    refreshRooms,
    invite,
    respondInvite,
  }
})
