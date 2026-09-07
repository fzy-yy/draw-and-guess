/**
  大厅在线状态与定向邀请 Store。
  管理大厅房间列表、在线玩家发现列表、接收与应答邀请。
*/
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { EVENTS, type Invite, type PresenceSnapshot, type RoomSnapshot } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'
import { notify } from '@/composables/useToasts'
import { socket } from './socket.ts'
import { createRequester } from './request.ts'

export const useLobbyStore = defineStore('lobby', () => {
  const presence = ref<PresenceSnapshot>({ players: [], rooms: [] })
  const invites = ref<Invite[]>([])
  const request = createRequester({ socket, notify })

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
    invite,
    respondInvite,
  }
})
