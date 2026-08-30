/**
 * 客户端视图状态与 Socket gateway。
 * Pinia 只保存服务端裁剪后的快照及本地偏好；所有影响胜负的操作都作为请求发送给权威服务端。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { io } from 'socket.io-client'
import { APP_CONFIG, PUBLIC_CONFIG } from '@draw-guess/config'
import {
  EVENTS,
  type Ack,
  type FillCommand,
  type Invite,
  type PresenceSnapshot,
  type PublicRoom,
  type Profile,
  type RoomSettings,
  type RoomSnapshot,
  type Stroke,
  type VocabularySnapshot,
} from '@draw-guess/shared'
import { createUuid } from '@/utils/createUuid'

export type ConnectionLabel = '正在连接' | '已连接' | '连接不稳定' | '正在重连' | '无法连接'
export type ShellPage = 'profile' | 'lobby' | 'settings'

interface StoredProfile extends Profile {
  recoveryToken?: string
  recoveryTokenExpiresAt?: number
}

/** 将只读配置默认值拓宽为可编辑的本地设置类型，允许用户自定义快捷键字符。 */
type LocalSettings = {
  -readonly [
    Key in keyof typeof PUBLIC_CONFIG.localSettings
  ]: (typeof PUBLIC_CONFIG.localSettings)[Key] extends string
    ? string
    : (typeof PUBLIC_CONFIG.localSettings)[Key]
}

/** Socket 实例放在 store 外，避免 Pinia devtools 序列化传输对象和监听器。 */
const socket = io({ autoConnect: true, reconnection: true, reconnectionAttempts: Infinity })

function randomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T
}

function loadProfile(): StoredProfile {
  try {
    const stored = localStorage.getItem(APP_CONFIG.app.storageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<StoredProfile>
      const avatarColor = new RegExp(APP_CONFIG.player.colorPattern).test(parsed.avatarColor ?? '')
        ? (parsed.avatarColor ?? APP_CONFIG.player.defaultAvatarColor)
        : randomItem(APP_CONFIG.player.avatarColors)
      if (typeof parsed.nickname === 'string') {
        return {
          nickname: parsed.nickname,
          avatarColor,
          ...(parsed.recoveryToken &&
          parsed.recoveryTokenExpiresAt &&
          parsed.recoveryTokenExpiresAt > Date.now()
            ? {
                recoveryToken: parsed.recoveryToken,
                recoveryTokenExpiresAt: parsed.recoveryTokenExpiresAt,
              }
            : {}),
        }
      }
    }
  } catch {
    // 本地存储损坏时安全回退到随机资料，不阻止玩家进入。
  }
  return {
    nickname: randomItem(APP_CONFIG.player.defaultNicknames),
    avatarColor: randomItem(APP_CONFIG.player.avatarColors),
  }
}

function loadSettings(): LocalSettings {
  try {
    const stored = localStorage.getItem(APP_CONFIG.app.settingsStorageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<LocalSettings>
      // 只复制当前配置声明的键，自动移除旧版本已经废弃的本地偏好。
      const loaded = Object.fromEntries(
        Object.entries(PUBLIC_CONFIG.localSettings).map(([key, fallback]) => [
          key,
          parsed[key as keyof LocalSettings] ?? fallback,
        ]),
      ) as LocalSettings
      // 快捷键必须是互不重复的单个可打印字符；损坏或旧版值逐项回退默认配置。
      const shortcutKeys = ['penShortcut', 'eraserShortcut', 'fillShortcut'] as const
      const shortcuts = shortcutKeys.map((key) => String(loaded[key]).trim().toLocaleLowerCase())
      const shortcutsAreValid =
        shortcuts.every((shortcut) => shortcut.length === 1) &&
        new Set(shortcuts).size === shortcutKeys.length
      shortcutKeys.forEach((key, index) => {
        loaded[key] = shortcutsAreValid
          ? (shortcuts[index] ?? PUBLIC_CONFIG.localSettings[key])
          : PUBLIC_CONFIG.localSettings[key]
      })
      return loaded
    }
  } catch {
    // 设置损坏不属于游戏状态错误，恢复默认值即可。
  }
  return { ...PUBLIC_CONFIG.localSettings }
}

export const useGameStore = defineStore('game', () => {
  const profile = ref<StoredProfile>(loadProfile())
  const settings = ref<LocalSettings>(loadSettings())
  const playerId = ref('')
  const page = ref<ShellPage>('profile')
  const connected = ref(socket.connected)
  const connectionLabel = ref<ConnectionLabel>('正在连接')
  const latency = ref(0)
  const presence = ref<PresenceSnapshot>({ players: [], rooms: [] })
  const room = ref<RoomSnapshot>()
  const vocabulary = ref<VocabularySnapshot>()
  const invites = ref<Invite[]>([])
  const toasts = ref<Array<{ id: string; type: 'success' | 'warning' | 'error'; text: string }>>([])
  const busy = ref(false)

  const me = computed(() => room.value?.members.find((member) => member.id === playerId.value))
  const isHost = computed(() => room.value?.hostId === playerId.value)
  const isDrawer = computed(() => room.value?.game?.drawerId === playerId.value)

  function notify(text: string, type: 'success' | 'warning' | 'error' = 'success'): void {
    const id = createUuid()
    toasts.value.push({ id, type, text })
    window.setTimeout(
      () => (toasts.value = toasts.value.filter((toast) => toast.id !== id)),
      APP_CONFIG.ui.toastDurationMs,
    )
  }

  /** 所有可失败请求使用 timeout + ack，并在这里统一翻译网络失败。 */
  async function request<T>(event: string, payload: Record<string, unknown> = {}): Promise<T> {
    const requestId = createUuid()
    try {
      const ack = (await socket
        .timeout(APP_CONFIG.network.requestTimeoutMs)
        .emitWithAck(event, { ...payload, requestId })) as Ack<T>
      if (!ack.ok) throw new Error(ack.error.message)
      return ack.data
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '请求失败，请检查主机服务与局域网连接'
      notify(
        message.includes('operation has timed out')
          ? '服务器响应超时；当前操作未确认，请检查连接后重试'
          : message,
        'error',
      )
      throw error
    }
  }

  async function register(): Promise<void> {
    if (!socket.connected) {
      notify('尚未连接到主机服务，请稍候再试', 'warning')
      return
    }
    busy.value = true
    try {
      const result = await request<{
        player: { id: string; nickname: string; avatarColor: string }
        recoveryToken: string
        restored: boolean
      }>(EVENTS.sessionRegister, {
        protocolVersion: APP_CONFIG.app.protocolVersion,
        profile: { nickname: profile.value.nickname, avatarColor: profile.value.avatarColor },
        preferences: {
          discoverable: settings.value.discoverable,
          acceptsInvites: settings.value.acceptsInvites,
        },
        ...(profile.value.recoveryToken ? { recoveryToken: profile.value.recoveryToken } : {}),
      })
      playerId.value = result.player.id
      profile.value = {
        ...profile.value,
        nickname: result.player.nickname,
        avatarColor: result.player.avatarColor,
        recoveryToken: result.recoveryToken,
        recoveryTokenExpiresAt: Date.now() + PUBLIC_CONFIG.network.recoveryTokenLifetimeMs,
      }
      saveProfile()
      page.value = 'lobby'
      notify(result.restored ? '座位与对局状态已恢复' : '已进入在线大厅')
    } finally {
      busy.value = false
    }
  }

  function saveProfile(): void {
    localStorage.setItem(APP_CONFIG.app.storageKey, JSON.stringify(profile.value))
  }

  function saveSettings(): void {
    localStorage.setItem(APP_CONFIG.app.settingsStorageKey, JSON.stringify(settings.value))
    document.documentElement.classList.toggle('color-friendly', settings.value.colorFriendly)
    if (playerId.value)
      void request(EVENTS.presenceUpdatePreferences, {
        discoverable: settings.value.discoverable,
        acceptsInvites: settings.value.acceptsInvites,
      })
  }

  function resetSettings(): void {
    settings.value = { ...PUBLIC_CONFIG.localSettings }
    saveSettings()
    notify('本地设置已恢复默认')
  }

  function clearProfile(): void {
    localStorage.removeItem(APP_CONFIG.app.storageKey)
    profile.value = loadProfile()
    playerId.value = ''
    room.value = undefined
    page.value = 'profile'
    notify('本地资料已清除；刷新后将作为新玩家进入', 'warning')
  }

  async function updateProfile(): Promise<void> {
    const result = await request<{ nickname: string; avatarColor: string }>(
      EVENTS.sessionUpdateProfile,
      { profile: { nickname: profile.value.nickname, avatarColor: profile.value.avatarColor } },
    )
    profile.value = { ...profile.value, ...result }
    saveProfile()
    notify('玩家资料已更新')
  }

  async function createRoom(input: { name: string; settings: RoomSettings }): Promise<void> {
    room.value = await request(EVENTS.roomCreate, input)
  }

  async function joinRoom(roomId: string): Promise<void> {
    room.value = await request(EVENTS.roomJoin, { roomId })
  }

  async function leaveRoom(): Promise<void> {
    await request(EVENTS.roomLeave)
    room.value = undefined
    vocabulary.value = undefined
    notify('已安全退出房间')
  }

  async function setReady(ready: boolean): Promise<void> {
    await request(EVENTS.roomSetReady, { ready })
  }

  async function updateRoomSettings(patch: Partial<RoomSettings>): Promise<void> {
    if (!room.value) return
    await request(EVENTS.roomUpdateSettings, { patch, expectedVersion: room.value.stateVersion })
  }

  async function loadVocabulary(): Promise<void> {
    vocabulary.value = await request(EVENTS.roomGetVocabulary)
  }

  async function saveVocabulary(ids: string[]): Promise<void> {
    if (!room.value) return
    vocabulary.value = await request(EVENTS.roomUpdateVocabulary, {
      ids,
      expectedVersion: room.value.stateVersion,
    })
    notify('本局词库已更新，所有人需要重新准备')
  }

  async function startGame(): Promise<void> {
    if (!room.value) return
    await request(EVENTS.gameStart, { expectedVersion: room.value.stateVersion })
  }

  async function chooseWord(wordId: string): Promise<void> {
    if (!room.value?.game) return
    await request(EVENTS.gameChooseWord, { roundId: room.value.game.roundId, wordId })
  }

  async function submitGuess(text: string): Promise<void> {
    if (!room.value?.game) return
    await request(EVENTS.guessSubmit, { roundId: room.value.game.roundId, text })
  }

  async function sendPreset(preset: string): Promise<void> {
    if (!room.value?.game) return
    await request(EVENTS.chatPreset, { roundId: room.value.game.roundId, preset })
  }

  async function sendStroke(stroke: Stroke): Promise<void> {
    if (!room.value?.game) return
    await request(EVENTS.drawStrokeBatch, { roundId: room.value.game.roundId, stroke })
  }

  /** 填充点击作为单条命令提交，服务端验证后才进入共享绘图历史。 */
  async function sendFill(fill: FillCommand): Promise<void> {
    if (!room.value?.game) return
    await request(EVENTS.drawFillCommit, { roundId: room.value.game.roundId, fill })
  }

  async function drawAction(event: string): Promise<void> {
    if (!room.value?.game) return
    await request(event, { roundId: room.value.game.roundId })
  }

  async function pause(reason = '房主暂停了游戏'): Promise<void> {
    await request(EVENTS.gamePauseRequest, { reason })
  }
  async function resume(): Promise<void> {
    await request(EVENTS.gameResume)
  }
  async function endEarly(): Promise<void> {
    await request(EVENTS.gameEndEarly)
  }
  async function returnWaiting(): Promise<void> {
    await request(EVENTS.gameReturnWaiting)
  }
  async function kick(targetId: string): Promise<void> {
    await request(EVENTS.roomKick, { targetId })
  }
  async function transferHost(targetId: string): Promise<void> {
    await request(EVENTS.roomTransferHost, { targetId })
  }
  async function invite(targetId: string): Promise<void> {
    await request(EVENTS.inviteSend, { targetId })
    notify('邀请已发送')
  }
  async function respondInvite(inviteId: string, accept: boolean): Promise<void> {
    const joined = await request<RoomSnapshot | undefined>(EVENTS.inviteRespond, {
      inviteId,
      accept,
    })
    invites.value = invites.value.filter((invite) => invite.id !== inviteId)
    if (joined) room.value = joined
  }

  function attachSocketListeners(): void {
    socket.on('connect', () => {
      connected.value = true
      connectionLabel.value = '已连接'
      if (playerId.value || profile.value.recoveryToken) void register()
    })
    socket.on('disconnect', (reason) => {
      connected.value = false
      connectionLabel.value = reason === 'io server disconnect' ? '无法连接' : '正在重连'
    })
    socket.io.on('reconnect_attempt', () => (connectionLabel.value = '正在重连'))
    socket.io.on('error', () => (connectionLabel.value = '连接不稳定'))
    socket.on(EVENTS.presenceSnapshot, (snapshot: PresenceSnapshot) => (presence.value = snapshot))
    socket.on(EVENTS.roomListChanged, (rooms: PublicRoom[]) => (presence.value.rooms = rooms))
    socket.on(EVENTS.roomSnapshot, (snapshot: RoomSnapshot) => (room.value = snapshot))
    socket.on(EVENTS.inviteReceived, (invite: Invite) => {
      invites.value.push(invite)
      notify(`${invite.from.nickname} 邀请你加入“${invite.roomName}”`, 'warning')
    })
    socket.on(
      EVENTS.inviteResolved,
      ({ id }: { id: string }) =>
        (invites.value = invites.value.filter((invite) => invite.id !== id)),
    )
    socket.on(EVENTS.roomClosed, ({ reason }: { reason: string }) => {
      room.value = undefined
      notify(reason, 'warning')
    })
    socket.on(EVENTS.systemNotice, ({ text }: { text: string }) => notify(text, 'warning'))
    socket.on(EVENTS.systemError, ({ message }: { message: string }) => notify(message, 'error'))
    socket.on(
      EVENTS.drawStrokeBatch,
      ({ roundId, stroke }: { roundId: string; stroke: Stroke }) => {
        const game = room.value?.game
        if (!game || game.roundId !== roundId) return
        const existing = game.strokes.find(
          (item): item is Stroke => item.kind === 'stroke' && item.id === stroke.id,
        )
        if (existing) {
          if (stroke.sequence <= existing.sequence) return
          existing.points.push(...stroke.points)
          existing.sequence = stroke.sequence
        } else game.strokes.push({ ...stroke, points: [...stroke.points] })
      },
    )
    socket.on(
      EVENTS.drawFillCommit,
      ({ roundId, fill }: { roundId: string; fill: FillCommand }) => {
        const game = room.value?.game
        if (!game || game.roundId !== roundId || game.strokes.some((item) => item.id === fill.id))
          return
        game.strokes.push(fill)
      },
    )
  }

  async function measureLatency(): Promise<void> {
    if (!playerId.value) return
    const started = Date.now()
    await request(EVENTS.networkPing, { clientTime: started })
    latency.value = Math.max(0, Date.now() - started)
  }

  attachSocketListeners()
  saveSettings()
  // 热刷新或页面重载时 Socket 可能先于 store 完成连接；主动恢复可消除这一竞态。
  if (socket.connected && profile.value.recoveryToken) queueMicrotask(() => void register())
  window.setInterval(() => void measureLatency(), APP_CONFIG.network.pingIntervalMs)

  return {
    config: PUBLIC_CONFIG,
    profile,
    settings,
    playerId,
    page,
    connected,
    connectionLabel,
    latency,
    presence,
    room,
    vocabulary,
    invites,
    toasts,
    busy,
    me,
    isHost,
    isDrawer,
    notify,
    register,
    saveProfile,
    saveSettings,
    resetSettings,
    clearProfile,
    updateProfile,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    updateRoomSettings,
    loadVocabulary,
    saveVocabulary,
    startGame,
    chooseWord,
    submitGuess,
    sendPreset,
    sendStroke,
    sendFill,
    drawAction,
    pause,
    resume,
    endEarly,
    returnWaiting,
    kick,
    transferHost,
    invite,
    respondInvite,
  }
})
